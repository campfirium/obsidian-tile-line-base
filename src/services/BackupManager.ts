import type {
	BackupCategory,
	BackupDescriptor,
	BackupIndex,
	FileBackupRecord,
	StoredBackupEntry
} from './backupTypes';

export type { BackupDescriptor } from './backupTypes';

import type { DataAdapter, Stat, TFile } from 'obsidian';
import { Plugin, normalizePath } from 'obsidian';
import { getLogger } from '../utils/logger';
import type { BackupSettings } from './SettingsService';
import {
	buildBackupFileName,
	buildLegacyEntryPath,
	getLegacyPathSegments,
	removeLegacyDirectoriesIfEmpty
} from './backupPath';
import { BUCKET_RULES, collectCandidates, resolveCategory, selectBucket } from './backupRetention';
import { migrateLegacyEntry } from './backupMigration';

const logger = getLogger('service:backup');

const BACKUP_DIR_NAME = 'backups';
const INDEX_FILE_NAME = 'index.json';
const BACKUP_EXTENSION = '.tlbkp';
const INDEX_VERSION = 1;
const LATEST_KEEP_COUNT = 3;
const MAX_CAPACITY_MB = 10_240; // Avoid unbounded JSON size if user inputs huge value
const FNV32_OFFSET_BASIS = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

interface SubtleCryptoLike {
	digest: (algorithm: string, data: ArrayBuffer | Uint8Array) => Promise<ArrayBuffer>;
}

interface CryptoLike {
	subtle?: SubtleCryptoLike;
}

interface BackupManagerOptions {
	plugin: Plugin;
	getSettings: () => BackupSettings;
}

export class BackupManager {
	private readonly plugin: Plugin;
	private readonly getSettings: () => BackupSettings;
	private readonly adapter: DataAdapter;
	private readonly pluginDir: string;
	private readonly backupsDir: string;
	private readonly indexPath: string;
	private readonly encoder = new TextEncoder();
	private index: BackupIndex = { version: INDEX_VERSION, totalSize: 0, files: {} };
	private queue: Promise<void> = Promise.resolve();
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	constructor(options: BackupManagerOptions) {
		this.plugin = options.plugin;
		this.getSettings = options.getSettings;
		this.adapter = this.plugin.app.vault.adapter;
		this.pluginDir = this.getPluginDir();
		this.backupsDir = normalizePath(`${this.pluginDir}/${BACKUP_DIR_NAME}`);
		this.indexPath = normalizePath(`${this.backupsDir}/${INDEX_FILE_NAME}`);
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}
		if (!this.initPromise) {
			this.initPromise = this.runExclusive(async () => {
				if (this.initialized) {
					return;
				}
				await this.ensureDirectory(this.pluginDir);
				await this.ensureDirectory(this.backupsDir);
				await this.loadIndex();
				const reconciled = await this.reconcileIndexWithFilesystem();
				if (reconciled) {
					await this.persistIndex();
				}
				await this.enforceCapacityUnsafe();
				await this.persistIndex();
				this.initialized = true;
			}).catch((error) => {
				logger.error('Failed to initialize backup manager', error);
				this.initPromise = null;
				throw error;
			});
		}
		return this.initPromise;
	}

	async ensureBackup(file: TFile, content: string): Promise<boolean> {
		await this.initialize();
		const settings = this.getSettings();
		if (!settings.enabled) {
			logger.debug('Backups disabled, skip ensureBackup', { path: file.path });
			return false;
		}

		return this.runExclusive(async () => {
			return this.createBackupUnsafe(file.path, content);
		});
	}

	async listBackups(file: TFile | string): Promise<BackupDescriptor[]> {
		await this.initialize();
		const filePath = typeof file === 'string' ? file : file.path;
		return this.runExclusive(async () => {
			const record = this.index.files[filePath];
			if (!record) {
				return [];
			}
			const now = Date.now();
			return record.entries.map((entry, index) => ({
				id: entry.id,
				createdAt: entry.createdAt,
				size: entry.size,
				category: resolveCategory(index, entry, now, LATEST_KEEP_COUNT, BUCKET_RULES)
			}));
		});
	}

	async restoreBackup(file: TFile, entryId: string): Promise<void> {
		await this.initialize();
		await this.runExclusive(async () => {
			const record = this.index.files[file.path];
			if (!record) {
				throw new Error(`No backups found for ${file.path}`);
			}
			const target = record.entries.find((entry) => entry.id === entryId);
			if (!target) {
				throw new Error(`Backup entry ${entryId} not found for ${file.path}`);
			}

			const backupPath = this.getEntryPath(file.path, target);
			let backupContent: string | null = null;
			try {
				backupContent = await this.adapter.read(backupPath);
			} catch (error) {
				logger.error('Failed to read backup file', { path: backupPath, error });
				throw error;
			}

			try {
				const currentContent = await this.plugin.app.vault.read(file);
				await this.createBackupUnsafe(file.path, currentContent);
			} catch (error) {
				logger.warn('Failed to create safety backup before restore', error);
			}

			await this.plugin.app.vault.modify(file, backupContent);
		});
	}

	async enforceCapacity(): Promise<void> {
		await this.initialize();
		await this.runExclusive(async () => {
			const modified = await this.enforceCapacityUnsafe();
			if (modified) {
				await this.persistIndex();
			}
		});
	}

	private async createBackupUnsafe(filePath: string, content: string): Promise<boolean> {
		const record = this.getOrCreateRecord(filePath);
		const encoded = this.encoder.encode(content);
		const size = encoded.byteLength;
		const hash = await this.computeHash(encoded);
		const latest = record.entries[0];
		if (latest && latest.hash === hash) {
			return false;
		}

		const timestamp = Date.now();
		const id = this.generateEntryId(record, timestamp);
		const entry: StoredBackupEntry = { id, createdAt: timestamp, size, hash };
		const entryPath = this.getEntryPath(filePath, entry);
		await this.adapter.write(entryPath, content);
		record.entries.unshift(entry);
		record.totalSize += size;
		this.index.totalSize += size;

		await this.applyRetentionForFile(filePath, record);
		await this.enforceCapacityUnsafe();
		await this.persistIndex();
		return true;
	}

	private async applyRetentionForFile(filePath: string, record: FileBackupRecord): Promise<boolean> {
		if (record.entries.length <= LATEST_KEEP_COUNT) {
			return false;
		}
		const now = Date.now();
		const sorted = [...record.entries].sort((a, b) => b.createdAt - a.createdAt);
		const keep = new Map<string, StoredBackupEntry>();
		const bucketUsage = new Set<string>();
		let modified = false;

		for (let index = 0; index < sorted.length; index++) {
			const entry = sorted[index];
			if (index < LATEST_KEEP_COUNT) {
				keep.set(entry.id, entry);
				continue;
			}
			const rule = selectBucket(BUCKET_RULES, now - entry.createdAt);
			const bucketKey = `${rule.category}:${Math.floor(entry.createdAt / rule.bucketSize)}`;
			if (!bucketUsage.has(bucketKey)) {
				bucketUsage.add(bucketKey);
				keep.set(entry.id, entry);
			} else {
				await this.deleteEntry(filePath, record, entry);
				modified = true;
			}
		}

		if (modified || keep.size !== record.entries.length) {
			record.entries = sorted.filter((entry) => keep.has(entry.id));
			return true;
		}
		return modified;
	}

	private async enforceCapacityUnsafe(): Promise<boolean> {
		const settings = this.getSettings();
		let limit = settings.maxSizeMB;
		if (!Number.isFinite(limit) || limit <= 0) {
			return false;
		}
		limit = Math.min(Math.max(1, Math.floor(limit)), MAX_CAPACITY_MB);
		const byteLimit = limit * 1024 * 1024;
		if (this.index.totalSize <= byteLimit) {
			return false;
		}

		const now = Date.now();
		let modified = false;
		const priority: BackupCategory[] = ['archive', 'weekly', 'daily', 'hourly', 'recent', 'latest'];

		for (const category of priority) {
			if (this.index.totalSize <= byteLimit) {
				break;
			}
			const candidates = collectCandidates(this.index.files, category, now, LATEST_KEEP_COUNT, BUCKET_RULES);
			for (const candidate of candidates) {
				if (this.index.totalSize <= byteLimit) {
					break;
				}
				const record = this.index.files[candidate.filePath];
				if (!record) {
					continue;
				}
				if (record.entries.length <= 1) {
					continue;
				}
				const removed = await this.deleteEntry(candidate.filePath, record, candidate.entry);
				if (removed) {
					modified = true;
				}
			}
		}

		return modified;
	}

	private async deleteEntry(filePath: string, record: FileBackupRecord, entry: StoredBackupEntry): Promise<boolean> {
		const index = record.entries.findIndex((candidate) => candidate.id === entry.id);
		if (index === -1) {
			return false;
		}
		record.entries.splice(index, 1);
		record.totalSize = Math.max(0, record.totalSize - entry.size);
		this.index.totalSize = Math.max(0, this.index.totalSize - entry.size);

		const entryPath = this.getEntryPath(filePath, entry);
		try {
			await this.adapter.remove(entryPath);
		} catch (error) {
			if (!this.isNotFoundError(error)) {
				logger.warn('Failed to remove backup entry', { entryPath, error });
			} else {
				const legacySegments = getLegacyPathSegments(filePath);
				const legacyPath = buildLegacyEntryPath(this.backupsDir, legacySegments, entry.id, BACKUP_EXTENSION);
				try {
					await this.adapter.remove(legacyPath);
					await removeLegacyDirectoriesIfEmpty(this.adapter, this.backupsDir, legacySegments);
				} catch (legacyError) {
					if (!this.isNotFoundError(legacyError)) {
						logger.warn('Failed to remove legacy backup entry', { legacyPath, error: legacyError });
					}
				}
			}
		}

		if (record.entries.length === 0) {
			delete this.index.files[filePath];
		}
		return true;
	}

	private generateEntryId(record: FileBackupRecord, timestamp: number): string {
		const base = this.formatTimestamp(timestamp);
		const existing = new Set(record.entries.map((entry) => entry.id));
		if (!existing.has(base)) {
			return base;
		}
		let counter = 1;
		let candidate = `${base}-${counter.toString().padStart(2, '0')}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base}-${counter.toString().padStart(2, '0')}`;
		}
		return candidate;
	}

	private async computeHash(data: Uint8Array): Promise<string> {
		const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto;
		if (cryptoApi?.subtle) {
			const digest = await cryptoApi.subtle.digest('SHA-256', data);
			return this.arrayBufferToHex(digest);
		}
		return this.fallbackHash(data);
	}

	private arrayBufferToHex(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let result = '';
		for (let index = 0; index < bytes.length; index++) {
			result += bytes[index].toString(16).padStart(2, '0');
		}
		return result;
	}

	private fallbackHash(data: Uint8Array): string {
		let hashA = FNV32_OFFSET_BASIS;
		let hashB = FNV32_OFFSET_BASIS;
		for (let index = 0; index < data.length; index++) {
			const value = data[index];
			hashA = Math.imul(hashA ^ value, FNV32_PRIME) >>> 0;
			hashB = Math.imul(hashB ^ ((value + index) & 0xff), FNV32_PRIME) >>> 0;
		}
		return (
			hashA.toString(16).padStart(8, '0') +
			hashB.toString(16).padStart(8, '0')
		);
	}

	private getOrCreateRecord(filePath: string): FileBackupRecord {
		const record = this.index.files[filePath];
		if (record) {
			return record;
		}
		const created: FileBackupRecord = { entries: [], totalSize: 0 };
		this.index.files[filePath] = created;
		return created;
	}

	private getPluginDir(): string {
		return normalizePath(`${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`);
	}

	private getEntryPath(filePath: string, entry: StoredBackupEntry): string {
		const fileName = buildBackupFileName(filePath, entry.id, BACKUP_EXTENSION);
		return normalizePath(`${this.backupsDir}/${fileName}`);
	}

	private async loadIndex(): Promise<void> {
		try {
			const raw = await this.adapter.read(this.indexPath);
			const parsed = JSON.parse(raw) as BackupIndex;
			if (!parsed || typeof parsed !== 'object' || parsed.version !== INDEX_VERSION) {
				logger.warn('Backup index version mismatch, resetting');
				this.index = { version: INDEX_VERSION, totalSize: 0, files: {} };
				return;
			}

			this.index = {
				version: INDEX_VERSION,
				totalSize: typeof parsed.totalSize === 'number' && parsed.totalSize >= 0 ? parsed.totalSize : 0,
				files: {}
			};
			for (const [filePath, record] of Object.entries(parsed.files ?? {})) {
				if (!record || typeof record !== 'object') {
					continue;
				}
				const entries = Array.isArray(record.entries) ? record.entries : [];
				const sanitizedEntries: StoredBackupEntry[] = [];
				for (const entry of entries) {
					if (!entry || typeof entry !== 'object') {
						continue;
					}
					const id = typeof entry.id === 'string' ? entry.id : null;
					const createdAt = typeof entry.createdAt === 'number' ? entry.createdAt : null;
					const size = typeof entry.size === 'number' ? entry.size : null;
					const hash = typeof entry.hash === 'string' ? entry.hash : null;
					if (!id || !createdAt || createdAt <= 0 || !size || size < 0 || !hash) {
						continue;
					}
					sanitizedEntries.push({ id, createdAt, size, hash });
				}
				if (sanitizedEntries.length === 0) {
					continue;
				}
				sanitizedEntries.sort((a, b) => b.createdAt - a.createdAt);
				this.index.files[filePath] = {
					entries: sanitizedEntries,
					totalSize: sanitizedEntries.reduce((sum, entry) => sum + entry.size, 0)
				};
			}
			this.index.totalSize = Object.values(this.index.files).reduce((sum, record) => sum + record.totalSize, 0);
		} catch (error) {
			if (this.isNotFoundError(error)) {
				this.index = { version: INDEX_VERSION, totalSize: 0, files: {} };
				return;
			}
			logger.error('Failed to load backup index', error);
			this.index = { version: INDEX_VERSION, totalSize: 0, files: {} };
		}
	}

	private async reconcileIndexWithFilesystem(): Promise<boolean> {
		let mutated = false;
		let totalSize = 0;
		for (const [filePath, record] of Object.entries(this.index.files)) {
			const entries: StoredBackupEntry[] = [];
			let recordSize = 0;
			const legacySegments = getLegacyPathSegments(filePath);
			for (const entry of record.entries) {
				const entryPath = this.getEntryPath(filePath, entry);
				let stat: Stat | null = null;
				try {
					stat = await this.adapter.stat(entryPath);
				} catch (error) {
					if (!this.isNotFoundError(error)) {
						logger.warn('Failed to stat backup entry during reconcile', { entryPath, error });
					}
				}
				if (!stat) {
					const migratedStat = await migrateLegacyEntry({
						adapter: this.adapter,
						backupsDir: this.backupsDir,
						entry,
						entryPath,
						legacySegments,
						backupExtension: BACKUP_EXTENSION,
						isNotFoundError: (error) => this.isNotFoundError(error),
						logger
					});
					if (migratedStat) {
						stat = migratedStat;
						mutated = true;
					}
				}
				if (!stat || stat.type !== 'file') {
					mutated = true;
					continue;
				}
				const size = stat.size;
				entries.push({ ...entry, size });
				recordSize += size;
			}
			if (entries.length === 0) {
				delete this.index.files[filePath];
				mutated = true;
				continue;
			}
			entries.sort((a, b) => b.createdAt - a.createdAt);
			this.index.files[filePath] = { entries, totalSize: recordSize };
			totalSize += recordSize;
		}
		this.index.totalSize = totalSize;
		return mutated;
	}

	private async persistIndex(): Promise<void> {
		const payload = JSON.stringify(this.index, null, 2);
		await this.adapter.write(this.indexPath, payload);
	}

	private async ensureDirectory(path: string): Promise<void> {
		if (await this.adapter.exists(path)) {
			return;
		}
		try {
			await this.adapter.mkdir(path);
		} catch (error) {
			if (!this.isAlreadyExistsError(error)) {
				throw error;
			}
		}
	}

	private isNotFoundError(error: unknown): boolean {
		return this.getErrorCode(error) === 'ENOENT';
	}

	private isAlreadyExistsError(error: unknown): boolean {
		return this.getErrorCode(error) === 'EEXIST';
	}

	private getErrorCode(error: unknown): string | null {
		if (error && typeof error === 'object' && 'code' in error) {
			const code = (error as { code?: unknown }).code;
			if (typeof code === 'string') {
				return code;
			}
		}
		return null;
	}

	private formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		const pad = (value: number, length = 2) => value.toString().padStart(length, '0');
		return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
	}

	private runExclusive<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.then(task);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}
}
