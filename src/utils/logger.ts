const GLOBAL_STORAGE_KEY = '__TILE_LINE_BASE_LOG_CONFIG__';
const CONSOLE_BRIDGE_KEY = 'TileLineBaseLogger';
const PREFIX = '[TileLineBase]';

export type LogLevelName = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_RANK: Record<LogLevelName, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4
};

const LOG_METHOD: Record<LogLevelName, keyof Console> = {
	error: 'error',
	warn: 'warn',
	info: 'info',
	debug: 'debug',
	trace: 'debug'
};


export interface LoggingConfig {
	globalLevel: LogLevelName;
	scopeLevels: Record<string, LogLevelName>;
}

export interface Logger {
	error: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
	trace: (...args: unknown[]) => void;
}

interface LoggerConsoleBridge {
	getConfig: () => LoggingConfig;
	setGlobalLevel: (level: LogLevelName) => LoggingConfig;
	setScopeLevel: (scope: string, level: LogLevelName) => LoggingConfig;
	clearScopeLevel: (scope: string) => LoggingConfig;
	reset: () => LoggingConfig;
	listScopes: () => string[];
}

const DEFAULT_CONFIG: LoggingConfig = {
	globalLevel: 'warn',
	scopeLevels: {}
};

declare const __LOG_PROD__: boolean;

type Listener = (config: LoggingConfig) => void;

const listeners = new Set<Listener>();

function readGlobalConfig(): LoggingConfig {
	const globalObj = typeof globalThis === 'undefined' ? {} as Record<string, unknown> : (globalThis as Record<string, unknown>);
	const stored = globalObj[GLOBAL_STORAGE_KEY];
	if (stored && typeof stored === 'object') {
		return normalizeLoggingConfig(stored as Partial<LoggingConfig>);
	}
	const config = { ...DEFAULT_CONFIG };
	globalObj[GLOBAL_STORAGE_KEY] = config;
	return config;
}

function writeGlobalConfig(config: LoggingConfig): void {
	const globalObj = typeof globalThis === 'undefined' ? {} as Record<string, unknown> : (globalThis as Record<string, unknown>);
	globalObj[GLOBAL_STORAGE_KEY] = config;
}

let activeConfig: LoggingConfig = readGlobalConfig();

function normalizeLoggingConfig(input: Partial<LoggingConfig> | undefined): LoggingConfig {
	const base = input ?? {};
	const scopeLevels: Record<string, LogLevelName> = {};
	const rawScopes = base.scopeLevels ?? {};
	for (const [scope, level] of Object.entries(rawScopes)) {
		const normalizedLevel = normalizeLevel(level);
		if (normalizedLevel) {
			scopeLevels[scope] = normalizedLevel;
		}
	}
	return {
		globalLevel: normalizeLevel(base.globalLevel) ?? DEFAULT_CONFIG.globalLevel,
		scopeLevels
	};
}

function normalizeLevel(level: unknown): LogLevelName | null {
	if (typeof level !== 'string') {
		return null;
	}
	switch (level) {
		case 'error':
		case 'warn':
		case 'info':
		case 'debug':
		case 'trace':
			return level;
		default:
			return null;
	}
}

function getEffectiveScopeLevel(scope: string): LogLevelName {
	if (!scope) {
		return activeConfig.globalLevel;
	}
	return activeConfig.scopeLevels[scope] ?? activeConfig.globalLevel;
}

function shouldLog(scope: string, level: LogLevelName): boolean {
	if (level === 'error' || level === 'warn') {
		return true;
	}
	const scopeLevel = getEffectiveScopeLevel(scope);
	return LEVEL_RANK[level] <= LEVEL_RANK[scopeLevel];
}

function makePrinter(scope: string, level: LogLevelName): (...args: unknown[]) => void {
	const method = LOG_METHOD[level];
	const globalConsole = typeof globalThis === 'undefined' ? null : globalThis.console;
	const consoleMethod = globalConsole && typeof globalConsole[method] === 'function'
		? globalConsole[method].bind(globalConsole)
		: globalConsole && typeof globalConsole.log === 'function'
			? globalConsole.log.bind(globalConsole)
			: () => {};
	if (__LOG_PROD__ && (level === 'info' || level === 'debug' || level === 'trace')) {
		return (...args: unknown[]) => {
			if (shouldLog(scope, level)) {
				consoleMethod(PREFIX, `[${scope}]`, ...args);
			}
		};
	}
	return (...args: unknown[]) => {
		if (shouldLog(scope, level)) {
			consoleMethod(PREFIX, `[${scope}]`, ...args);
		}
	};
}

function createScopedLogger(scope: string): Logger {
	const safeScope = scope || 'global';
	return {
		error: makePrinter(safeScope, 'error'),
		warn: makePrinter(safeScope, 'warn'),
		info: makePrinter(safeScope, 'info'),
		debug: makePrinter(safeScope, 'debug'),
		trace: makePrinter(safeScope, 'trace')
	};
}

export function getLogger(scope: string): Logger {
	return createScopedLogger(scope);
}

export function getLoggingConfig(): LoggingConfig {
	return {
		globalLevel: activeConfig.globalLevel,
		scopeLevels: { ...activeConfig.scopeLevels }
	};
}

export function setLoggingConfig(config: LoggingConfig): LoggingConfig {
	activeConfig = normalizeLoggingConfig(config);
	writeGlobalConfig(activeConfig);
	notifyListeners(activeConfig);
	return getLoggingConfig();
}

export function updateLoggingConfig(partial: Partial<LoggingConfig>): LoggingConfig {
	const next: LoggingConfig = normalizeLoggingConfig({
		...activeConfig,
		...partial,
		scopeLevels: {
			...activeConfig.scopeLevels,
			...(partial.scopeLevels ?? {})
		}
	});
	return setLoggingConfig(next);
}

export function setGlobalLogLevel(level: LogLevelName): LoggingConfig {
	return setLoggingConfig({
		...activeConfig,
		globalLevel: level
	});
}

export function setScopeLogLevel(scope: string, level: LogLevelName): LoggingConfig {
	if (!scope) {
		return getLoggingConfig();
	}
	return setLoggingConfig({
		...activeConfig,
		scopeLevels: {
			...activeConfig.scopeLevels,
			[scope]: level
		}
	});
}

export function clearScopeLogLevel(scope: string): LoggingConfig {
	if (!scope) {
		return getLoggingConfig();
	}
	const rest = { ...activeConfig.scopeLevels };
	delete rest[scope];
	return setLoggingConfig({
		...activeConfig,
		scopeLevels: rest
	});
}

export function resetLoggingConfig(): LoggingConfig {
	return setLoggingConfig(DEFAULT_CONFIG);
}

function notifyListeners(config: LoggingConfig): void {
	for (const listener of listeners) {
		try {
			listener(config);
		} catch {
			// swallow listener errors to avoid cascading failures
		}
	}
}

export function subscribeLoggingConfig(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export interface LoggerConsoleBridgeOptions {
	persist?: (config: LoggingConfig) => void | Promise<void>;
}

export function installLoggerConsoleBridge(options?: LoggerConsoleBridgeOptions): void {
	const globalObj = typeof globalThis === 'undefined' ? {} as Record<string, unknown> : (globalThis as Record<string, unknown>);
	const existing = globalObj[CONSOLE_BRIDGE_KEY] as LoggerConsoleBridge | undefined;
	if (existing) {
		return;
	}

	const persist = (config: LoggingConfig) => {
		try {
			const result = options?.persist?.(config);
			if (result && typeof (result as Promise<unknown>).catch === 'function') {
				(result as Promise<unknown>).catch(() => {
					// ignore persist errors
				});
			}
		} catch {
			// ignore persist errors
		}
	};

	const bridge: LoggerConsoleBridge = {
		getConfig: () => getLoggingConfig(),
		setGlobalLevel: (level) => {
			const normalized = normalizeLevel(level) ?? activeConfig.globalLevel;
			const updated = setGlobalLogLevel(normalized);
			persist(updated);
			return updated;
		},
		setScopeLevel: (scope, level) => {
			const normalized = normalizeLevel(level);
			if (!normalized) {
				return getLoggingConfig();
			}
			const updated = setScopeLogLevel(scope, normalized);
			persist(updated);
			return updated;
		},
		clearScopeLevel: (scope) => {
			const updated = clearScopeLogLevel(scope);
			persist(updated);
			return updated;
		},
		reset: () => {
			const updated = resetLoggingConfig();
			persist(updated);
			return updated;
		},
		listScopes: () => Object.keys(getLoggingConfig().scopeLevels)
	};

	globalObj[CONSOLE_BRIDGE_KEY] = bridge;
}

export function applyLoggingConfig(config: LoggingConfig): void {
	setLoggingConfig(config);
}

export type LoggerLevel = LogLevelName;
