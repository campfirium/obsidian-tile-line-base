import type { BackupCategory, BucketRule, FileBackupRecord, StoredBackupEntry } from './backupTypes';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const BUCKET_RULES: BucketRule[] = [
	{ category: 'recent', maxAge: 5 * MINUTE, bucketSize: 5 * MINUTE },
	{ category: 'hourly', maxAge: 60 * MINUTE, bucketSize: 10 * MINUTE },
	{ category: 'daily', maxAge: 24 * HOUR, bucketSize: HOUR },
	{ category: 'weekly', maxAge: 7 * DAY, bucketSize: DAY },
	{ category: 'archive', maxAge: Number.POSITIVE_INFINITY, bucketSize: WEEK }
];

export function selectBucket(rules: BucketRule[], age: number): BucketRule {
	for (const rule of rules) {
		if (age <= rule.maxAge) {
			return rule;
		}
	}
	return rules[rules.length - 1];
}

export function resolveCategory(
	index: number,
	entry: StoredBackupEntry,
	now: number,
	latestKeepCount: number,
	rules: BucketRule[]
): BackupCategory {
	if (index < latestKeepCount) {
		return 'latest';
	}
	const rule = selectBucket(rules, now - entry.createdAt);
	return rule.category;
}

export function collectCandidates(
	files: Record<string, FileBackupRecord>,
	category: BackupCategory,
	now: number,
	latestKeepCount: number,
	rules: BucketRule[]
): { filePath: string; entry: StoredBackupEntry }[] {
	const result: { filePath: string; entry: StoredBackupEntry }[] = [];
	for (const [filePath, record] of Object.entries(files)) {
		for (let index = 0; index < record.entries.length; index++) {
			const entry = record.entries[index];
			const entryCategory = resolveCategory(index, entry, now, latestKeepCount, rules);
			if (entryCategory === category) {
				result.push({ filePath, entry });
			}
		}
	}
	return result.sort((a, b) => a.entry.createdAt - b.entry.createdAt);
}
