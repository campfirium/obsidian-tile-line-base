import type { TFile, Vault } from 'obsidian';
import { t } from '../i18n';

export function extractSample(content: string): string {
	const withoutFrontmatter = stripFrontmatter(content);
	const segments = withoutFrontmatter.split(/\n\s*\n/);
	for (const segment of segments) {
		const normalized = segment
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.join('\n');
		if (isTopHeadingOnly(normalized)) continue;
		if (normalized.length > 0) return truncateTemplate(normalized);
	}

	const firstLine = withoutFrontmatter
		.split('\n')
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !/^#\s+/.test(line));
	return truncateTemplate(firstLine ?? '');
}

export function truncateTemplate(raw: string): string {
	const limit = 320;
	return raw.length <= limit ? raw : `${raw.slice(0, limit)}...`;
}

export function stripFrontmatter(content: string): string {
	return splitFrontmatter(content).body;
}

export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
	if (!content.startsWith('---')) return { frontmatter: null, body: content };
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(content);
	if (!match) return { frontmatter: null, body: content };
	return { frontmatter: match[0], body: content.slice(match[0].length) };
}

export function mergeFrontmatter(frontmatter: string | null, markdown: string): string {
	if (!frontmatter) return markdown;
	const normalized = frontmatter.endsWith('\n') ? frontmatter : `${frontmatter}\n`;
	const spacer = /(\r?\n){2}$/.test(normalized) ? '' : '\n';
	return `${normalized}${spacer}${markdown}`;
}

export function isTopHeadingOnly(text: string): boolean {
	if (!text.trim()) return false;
	const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
	return lines.length > 0 && lines.every((line) => /^#\s+/.test(line) && !/^##/.test(line));
}

export function buildTargetFileName(file: TFile): string {
	const base = `${file.basename}_tlb`;
	return sanitizeFileName(base) || t('magicMigration.defaultFileName');
}

export async function resolveTargetPath(vault: Vault, file: TFile, baseName: string): Promise<string> {
	const folder = file.parent?.path ?? '';
	let candidate = folder ? `${folder}/${baseName}.md` : `${baseName}.md`;
	if (!vault.getAbstractFileByPath(candidate)) return candidate;
	let counter = 2;
	while (counter < 500) {
		const nextBase = `${baseName} ${counter}`;
		candidate = folder ? `${folder}/${nextBase}.md` : `${nextBase}.md`;
		if (!vault.getAbstractFileByPath(candidate)) return candidate;
		counter += 1;
	}
	return folder ? `${folder}/${baseName} ${Date.now()}.md` : `${baseName} ${Date.now()}.md`;
}

export function sanitizeFileName(raw: string): string {
	return raw.replace(/[\\/:*?"<>|#]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
}

export function sliceFromSample(content: string, sample: string): string | null {
	const trimmedSample = sample.trim();
	if (!trimmedSample) return content;
	const anchorIndex = content.indexOf(trimmedSample);
	return anchorIndex === -1 ? null : content.slice(anchorIndex);
}
