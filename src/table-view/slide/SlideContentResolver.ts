import type { RowData } from '../../grid/GridAdapter';
import type { SlideTextTemplate } from '../../types/slide';

export type SlideBodyBlock = { type: 'text'; text: string } | { type: 'image'; markdown: string };

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tif', 'tiff', 'avif', 'heic', 'heif'];
const MARKDOWN_IMAGE_PATTERN = /^!\[[^\]]*]\([^)]+\)$/i;
const EMBED_IMAGE_PATTERN = /^!\[\[.+]]$/;
const WIKILINK_PATTERN = /^\[\[(.+)]]$/;
const IMAGE_PATH_PATTERN =
	/^(?:https?:\/\/[^\s]+|data:image\/[^\s]+|[^\s]+?\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?|avif|heic|heif)(?:\?[^\s]*)?)$/i;

interface SlideContentOptions {
	row: RowData;
	fields: string[];
	template: SlideTextTemplate;
	activeIndex: number;
	reservedFields: Set<string>;
	imageValue?: string | null;
	includeBodyImages?: boolean;
}

export function resolveSlideContent(options: SlideContentOptions): { title: string; blocks: SlideBodyBlock[] } {
	const orderedFields = options.fields.filter((field) => field && !options.reservedFields.has(field));
	const values: Record<string, string> = {};
	for (const field of orderedFields) {
		if (field === 'status') continue;
		const raw = options.row[field];
		const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
		if (!text) continue;
		values[field] = text;
	}

	const renderTemplate = (templateText: string): string => renderSlideTemplate(templateText, values, options.reservedFields);

	const titleTemplate = options.template.titleTemplate ?? '';
	const rawTitle = titleTemplate ? renderTemplate(titleTemplate) : '';
	const title = rawTitle;

	const body = renderTemplate(options.template.bodyTemplate);
	const lines = body ? body.split('\n') : [];
	const templateAllowsImages = containsImageMarker(options.template.bodyTemplate ?? '') || containsImageMarker(body ?? '');
	const allowImages = options.includeBodyImages !== false || templateAllowsImages;
	const blocks: SlideBodyBlock[] = [];
	for (const line of lines) {
		if (line.trim().length === 0) {
			blocks.push({ type: 'text', text: '' });
			continue;
		}
		if (allowImages) {
			const imageMarkdown = resolveImageMarkdown(line, values);
			if (imageMarkdown) {
				blocks.push({ type: 'image', markdown: imageMarkdown });
				continue;
			}
		}
		blocks.push({ type: 'text', text: line });
	}
	const imageMarkdown = resolveDirectImage(options.imageValue);
	if (imageMarkdown) {
		blocks.push({ type: 'image', markdown: imageMarkdown });
	}
	return { title, blocks };
}

export function renderSlideTemplate(
	templateText: string,
	values: Record<string, string>,
	reservedFields: Set<string>
): string {
	const input = (templateText ?? '').replace(/\r\n/g, '\n');
	return input.replace(/\{([^{}]+)\}/g, (_, key: string) => {
		const field = key.trim();
		if (!field || reservedFields.has(field)) {
			return '';
		}
		return values[field] ?? '';
	});
}

function containsImageMarker(text: string): boolean {
	const normalized = (text ?? '').trim();
	if (!normalized) return false;
	return normalized.includes('![') || normalized.includes('![[');
}

function resolveImageMarkdown(line: string, _values: Record<string, string>): string | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}
	const token = extractFirstImageToken(trimmed);
	return token ? normalizeImageToken(token) : null;
}

export function resolveDirectImage(value: string | null | undefined): string | null {
	if (!value || typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const token = extractFirstImageToken(trimmed);
	return token ? normalizeImageToken(token) : null;
}

function extractFirstImageToken(text: string): string | null {
	const markdown = text.match(MARKDOWN_IMAGE_PATTERN);
	if (markdown) return markdown[0];
	const embed = text.match(EMBED_IMAGE_PATTERN);
	if (embed) return embed[0];
	const wikilink = text.match(WIKILINK_PATTERN);
	if (wikilink && isImagePath(wikilink[1])) {
		return wikilink[0];
	}
	const httpMatch = text.match(/https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?|avif|heic|heif)/i);
	if (httpMatch) return httpMatch[0];
	const dataMatch = text.match(/data:image\/[^\s]+/i);
	if (dataMatch) return dataMatch[0];
	const fileMatch = text.match(/[^\s]+?\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?|avif|heic|heif)/i);
	if (fileMatch) return fileMatch[0];
	return null;
}

function normalizeImageToken(token: string): string | null {
	const trimmed = token.trim();
	if (!trimmed) return null;
	if (MARKDOWN_IMAGE_PATTERN.test(trimmed) || EMBED_IMAGE_PATTERN.test(trimmed)) {
		return trimmed;
	}
	if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
		return `![](${trimmed})`;
	}
	const wikilink = trimmed.match(WIKILINK_PATTERN);
	if (wikilink && isImagePath(wikilink[1])) {
		return `![[${wikilink[1]}]]`;
	}
	if (isImagePath(trimmed)) {
		return `![[${trimmed}]]`;
	}
	return null;
}

function isImagePath(value: string): boolean {
	const normalized = value.trim();
	if (!normalized || normalized.includes('\n')) {
		return false;
	}
	if (MARKDOWN_IMAGE_PATTERN.test(normalized) || EMBED_IMAGE_PATTERN.test(normalized)) {
		return true;
	}
	const wikilinkMatch = normalized.match(WIKILINK_PATTERN);
	if (wikilinkMatch && wikilinkMatch[1]) {
		return hasImageExtension(wikilinkMatch[1]);
	}
	if (IMAGE_PATH_PATTERN.test(normalized)) {
		return true;
	}
	return hasImageExtension(normalized);
}

function hasImageExtension(value: string): boolean {
	const lower = value.toLowerCase();
	return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}
