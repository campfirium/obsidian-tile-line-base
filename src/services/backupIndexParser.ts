import type { BackupIndex, StoredBackupEntry } from './backupTypes';

export function parseBackupIndex(raw: string, version: number): BackupIndex | null {
	const parsed = JSON.parse(raw) as BackupIndex;
	if (!parsed || typeof parsed !== 'object' || parsed.version !== version) {
		return null;
	}

	const index: BackupIndex = {
		version,
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
			const isInitial = entry.isInitial === true ? true : undefined;
			const primaryFieldValue = typeof entry.primaryFieldValue === 'string' && entry.primaryFieldValue.trim().length > 0
				? entry.primaryFieldValue
				: undefined;
			const changePreview = typeof entry.changePreview === 'string' ? entry.changePreview : undefined;
			if (!id || !createdAt || createdAt <= 0 || !size || size < 0 || !hash) {
				continue;
			}
			sanitizedEntries.push({ id, createdAt, size, hash, isInitial, primaryFieldValue, changePreview });
		}
		if (sanitizedEntries.length === 0) {
			continue;
		}
		sanitizedEntries.sort((a, b) => b.createdAt - a.createdAt);
		index.files[filePath] = {
			entries: sanitizedEntries,
			totalSize: sanitizedEntries.reduce((sum, entry) => sum + entry.size, 0)
		};
	}

	index.totalSize = Object.values(index.files).reduce((sum, record) => sum + record.totalSize, 0);
	return index;
}
