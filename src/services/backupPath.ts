import { normalizePath, type DataAdapter } from 'obsidian';
import { isSafeBackupEntryId, isSafeBackupRelativePath } from './backupValidation';

const PATH_HASH_LENGTH = 12;
const MAX_SLUG_LENGTH = 60;
const HASH_OFFSET = 0x811c9dc5;
const HASH_PRIME = 0x01000193;

function sanitizeSlug(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const segments = normalized.split('/').filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return 'root';
	}
	const trimmed = segments
		.map((segment) => segment.replace(/[^A-Za-z0-9_-]+/g, '-'))
		.filter((segment) => segment.length > 0);
	const joined = trimmed.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
	if (!joined) {
		return 'root';
	}
	if (joined.length <= MAX_SLUG_LENGTH) {
		return joined;
	}
	return joined.slice(-MAX_SLUG_LENGTH);
}

function hashPath(input: string): string {
	let hashA = HASH_OFFSET;
	let hashB = HASH_OFFSET;
	for (let index = 0; index < input.length; index++) {
		const code = input.charCodeAt(index);
		hashA = Math.imul(hashA ^ code, HASH_PRIME) >>> 0;
		hashB = Math.imul(hashB ^ ((code ^ index) & 0xff), HASH_PRIME) >>> 0;
	}
	const combined = hashA.toString(16).padStart(8, '0') + hashB.toString(16).padStart(8, '0');
	return combined.slice(0, PATH_HASH_LENGTH);
}

function joinPath(base: string, ...segments: string[]): string {
	if (![base, ...segments].every(isSafeBackupRelativePath)) {
		throw new Error('Invalid backup path');
	}
	const parts = [base, ...segments].filter((part) => part.length > 0);
	const result = normalizePath(parts.join('/'));
	if (!result.startsWith(`${normalizePath(base)}/`)) throw new Error('Backup path escapes its directory');
	return result;
}

function isNotFoundError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === 'object' &&
			'code' in error &&
			typeof (error as { code?: unknown }).code === 'string' &&
			(error as { code: string }).code === 'ENOENT'
	);
}

export function buildBackupFileName(filePath: string, entryId: string, extension: string): string {
	validateEntryPath(filePath, entryId, extension);
	const hash = hashPath(filePath);
	const slug = sanitizeSlug(filePath);
	return `${hash}-${slug}-${entryId}${extension}`;
}

export function getLegacyPathSegments(filePath: string): string[] {
	if (!isSafeBackupRelativePath(filePath)) throw new Error('Invalid backup source path');
	const normalized = filePath.replace(/\\/g, '/');
	const segments = normalized.split('/').filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return ['root'];
	}
	const fileName = segments.pop() ?? 'root';
	const baseName = fileName.replace(/\.[^./\\]+$/, '') || fileName;
	return [...segments, baseName];
}

export function buildLegacyEntryPath(baseDir: string, segments: string[], entryId: string, extension: string): string {
	validateEntryPath(segments.join('/'), entryId, extension);
	return joinPath(baseDir, ...segments, `${entryId}${extension}`);
}

function validateEntryPath(filePath: string, entryId: string, extension: string): void {
	if (!isSafeBackupRelativePath(filePath) || !isSafeBackupEntryId(entryId) || extension !== '.tlbkp') {
		throw new Error('Invalid backup entry path');
	}
}

export async function removeLegacyDirectoriesIfEmpty(
	adapter: DataAdapter,
	baseDir: string,
	segments: string[]
): Promise<void> {
	for (let count = segments.length; count > 0; count--) {
		const dirPath = joinPath(baseDir, ...segments.slice(0, count));
		try {
			const listing = await adapter.list(dirPath);
			if (listing.files.length + listing.folders.length > 0) {
				break;
			}
			await adapter.rmdir(dirPath, false);
		} catch (error) {
			if (!isNotFoundError(error)) {
				break;
			}
		}
	}
}
