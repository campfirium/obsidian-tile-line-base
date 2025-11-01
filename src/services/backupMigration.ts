import type { DataAdapter, Stat } from 'obsidian';
import type { StoredBackupEntry } from './backupTypes';
import { buildLegacyEntryPath, removeLegacyDirectoriesIfEmpty } from './backupPath';
import type { Logger } from '../utils/logger';

interface LegacyMigrationContext {
	adapter: DataAdapter;
	backupsDir: string;
	entry: StoredBackupEntry;
	entryPath: string;
	legacySegments: string[];
	backupExtension: string;
	isNotFoundError: (error: unknown) => boolean;
	logger: Logger;
}

export async function migrateLegacyEntry(context: LegacyMigrationContext): Promise<Stat | null> {
	const { adapter, backupsDir, entry, entryPath, legacySegments, backupExtension, isNotFoundError, logger } = context;
	const legacyPath = buildLegacyEntryPath(backupsDir, legacySegments, entry.id, backupExtension);
	let legacyStat: Stat | null = null;
	try {
		legacyStat = await adapter.stat(legacyPath);
	} catch (error) {
		if (!isNotFoundError(error)) {
			logger.warn('Failed to stat legacy backup entry during reconcile', {
				entryPath: legacyPath,
				error
			});
		}
		return null;
	}

	if (!legacyStat || legacyStat.type !== 'file') {
		return null;
	}

	let migrated = false;
	try {
		await adapter.rename(legacyPath, entryPath);
		migrated = true;
	} catch (renameError) {
		logger.warn('Failed to migrate legacy backup entry via rename, attempting copy', {
			legacyPath,
			entryPath,
			error: renameError
		});
		try {
			const data = await adapter.readBinary(legacyPath);
			await adapter.writeBinary(entryPath, data);
			try {
				await adapter.remove(legacyPath);
			} catch (removeError) {
				if (!isNotFoundError(removeError)) {
					logger.warn('Failed to remove legacy entry after copy', {
						legacyPath,
						error: removeError
					});
				}
			}
			migrated = true;
		} catch (copyError) {
			logger.warn('Failed to migrate legacy backup entry via copy', {
				legacyPath,
				entryPath,
				error: copyError
			});
		}
	}

	if (!migrated) {
		return null;
	}

	await removeLegacyDirectoriesIfEmpty(adapter, backupsDir, legacySegments);
	try {
		return await adapter.stat(entryPath);
	} catch (statError) {
		logger.warn('Failed to stat migrated backup entry', { entryPath, error: statError });
		return null;
	}
}

