import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';

const PATH_HASH_LENGTH = 12;
const MAX_SLUG_LENGTH = 60;

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

export function buildBackupFileName(filePath: string, entryId: string, extension: string): string {
	const hash = createHash('sha1').update(filePath).digest('hex').slice(0, PATH_HASH_LENGTH);
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
	return join(baseDir, ...segments, `${entryId}${extension}`);
}

export async function removeLegacyDirectoriesIfEmpty(baseDir: string, segments: string[]): Promise<void> {
	for (let count = segments.length; count > 0; count--) {
		const dirPath = join(baseDir, ...segments.slice(0, count));
		try {
			const contents = await fs.readdir(dirPath);
			if (contents.length > 0) {
				break;
			}
			await fs.rmdir(dirPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				continue;
			}
			break;
		}
	}
}
