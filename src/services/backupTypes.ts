export type BackupCategory = 'latest' | 'recent' | 'hourly' | 'daily' | 'weekly' | 'archive';

export interface StoredBackupEntry {
	id: string;
	createdAt: number;
	size: number;
	hash: string;
}

export interface FileBackupRecord {
	entries: StoredBackupEntry[];
	totalSize: number;
}

export interface BackupIndex {
	version: number;
	totalSize: number;
	files: Record<string, FileBackupRecord>;
}

export interface BackupDescriptor {
	id: string;
	createdAt: number;
	size: number;
	category: BackupCategory;
}

export interface BucketRule {
	category: Exclude<BackupCategory, 'latest'>;
	maxAge: number;
	bucketSize: number;
}
