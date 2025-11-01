import { normalizePath, type DataAdapter } from 'obsidian';

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
	const parts = [base, ...segments].filter((part) => part.length > 0);
	return normalizePath(parts.join('/'));
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
	const hash = hashPath(filePath);
	const slug = sanitizeSlug(filePath);
	return `${hash}-${slug}-${entryId}${extension}`;
}

export function getLegacyPathSegments(filePath: string): string[] {
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
	return joinPath(baseDir, ...segments, `${entryId}${extension}`);
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
