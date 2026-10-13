import type { TableConfigData } from '../TableConfigManager';
import { getPluginContext } from '../../pluginContext';

interface ConfigOperation {
	settled: Promise<void>;
}

const operations = new WeakMap<object, Map<string, ConfigOperation>>();

/** Serialize config imports and writes across sibling views of the same file. */
export async function runConfigOperation<T>(path: string, action: () => Promise<T>): Promise<T> {
	const owner = getPluginContext();
	if (!owner) return action();
	let files = operations.get(owner);
	if (!files) {
		files = new Map();
		operations.set(owner, files);
	}
	const previous = files.get(path);
	let finish: () => void = () => undefined;
	const operation: ConfigOperation = {
		settled: new Promise<void>(resolve => { finish = resolve; })
	};
	files.set(path, operation);
	try {
		await previous?.settled;
		return await action();
	} finally {
		finish();
		if (files.get(path) === operation) files.delete(path);
	}
}

export function stableConfigIdentity(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableConfigIdentity).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableConfigIdentity(entry)}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'undefined';
}

/** Apply only locally edited fields to settings that may have changed elsewhere. */
export function mergeConfigEdits(base: TableConfigData, local: TableConfigData, latest: TableConfigData): TableConfigData {
	return Object.assign({}, latest, mergeEditedValue(base, local, latest));
}

function mergeEditedValue(base: unknown, local: unknown, latest: unknown): unknown {
	if (stableConfigIdentity(base) === stableConfigIdentity(local)) return latest;
	if (isRecord(base) && isRecord(local) && isRecord(latest)) {
		const result = Object.assign({}, latest);
		for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
			result[key] = mergeEditedValue(base[key], local[key], latest[key]);
		}
		return Object.assign({}, latest, result);
	}
	if (Array.isArray(base) && Array.isArray(local) && Array.isArray(latest) &&
		base.every(hasId) && local.every(hasId) && latest.every(hasId)) {
		const result = latest.filter(entry => !base.some(old => old.id === entry.id) || local.some(next => next.id === entry.id));
		for (const entry of local) {
			const before = base.find(old => old.id === entry.id);
			const index = result.findIndex(current => current.id === entry.id);
			if (index < 0) {
				if (!before || stableConfigIdentity(before) !== stableConfigIdentity(entry)) result.push(entry);
			} else result[index] = Object.assign({}, result[index], mergeEditedValue(before, entry, result[index]));
		}
		if (stableConfigIdentity(base.map(entry => entry.id)) !== stableConfigIdentity(local.map(entry => entry.id))) {
			const order = new Map(local.map((entry, index) => [entry.id, index]));
			result.sort((left, right) => (order.get(left.id) ?? local.length) - (order.get(right.id) ?? local.length));
		}
		return result;
	}
	return local;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasId(value: unknown): value is Record<string, unknown> & { id: string } {
	return isRecord(value) && typeof value.id === 'string';
}
