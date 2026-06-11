import type { RowData } from '../../grid/GridAdapter';
import type { SlideBodyBlock, SlideTextTemplate } from '../../types/slide';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tif', 'tiff', 'avif', 'heic', 'heif'];
const SAFE_DATA_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
const MAX_DATA_IMAGE_URI_LENGTH = 1024 * 1024;
const MARKDOWN_IMAGE_PATTERN = /^!\[[^\]]*]\([^)]+\)$/i;
const EMBED_IMAGE_PATTERN = /^!\[\[.+]]$/;
const WIKILINK_PATTERN = /^\[\[(.+)]]$/;
const IMAGE_PATH_PATTERN =
	/^(?:https?:\/\/[^\s]+|data:image\/[^\s]+|[^\s]+?\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?|avif|heic|heif)(?:[?#][^\s]*)?)$/i;
const MARKDOWN_IMAGE_TOKEN_PATTERN = /!\[[^\]]*]\((?:<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;
const INLINE_MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)]\((<[^>\n]+>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?)\)/g;
const INLINE_EMBED_IMAGE_PATTERN = /!\[\[([^\]]+)]]/g;

interface SlideContentOptions {
	row: RowData;
	fields: string[];
	template: SlideTextTemplate;
	activeIndex: number;
	reservedFields: Set<string>;
	imageValue?: string | null;
	excludeFields?: Set<string> | string[] | null;
}

export function resolveSlideContent(options: SlideContentOptions): { title: string; blocks: SlideBodyBlock[] } {
	const excluded = options.excludeFields
		? new Set(Array.isArray(options.excludeFields) ? options.excludeFields : Array.from(options.excludeFields))
		: null;
	const orderedFields = options.fields.filter(
		(field) => field && !options.reservedFields.has(field) && !(excluded && excluded.has(field))
	);
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
	const blocks: SlideBodyBlock[] = [];
	for (const line of lines) {
		if (line.trim().length === 0) {
			blocks.push({ type: 'text', text: '' });
			continue;
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
	const candidates: string[] = [];
	const patterns: RegExp[] = [
		MARKDOWN_IMAGE_TOKEN_PATTERN, // markdown image
		/!\[\[[^\]]+?]]/g, // embed image
		/\[\[([^\]]+?\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?|avif|heic|heif))(?:\|[^\]]*)?]]/gi, // wikilink with image extension
		/https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?|avif|heic|heif)(?:\?[^\s]*)?/gi,
		/data:image\/[^\s]+/gi,
		/[^\s]+?\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?|avif|heic|heif)(?:\?[^\s]*)?/gi
	];
	for (const pattern of patterns) {
		const match = pattern.exec(text);
		if (match && match[0]) {
			candidates.push(match[0]);
			break;
		}
	}
	if (candidates.length === 0) {
		return null;
	}
	return candidates[0].trim();
}

function normalizeImageToken(token: string): string | null {
	const trimmed = token.trim();
	if (!trimmed) return null;
	if (MARKDOWN_IMAGE_PATTERN.test(trimmed)) {
		const target = extractMarkdownImageTarget(trimmed);
		return target && isAllowedImageReference(target) ? trimmed : null;
	}
	if (EMBED_IMAGE_PATTERN.test(trimmed)) {
		const target = extractEmbedImageTarget(trimmed);
		return target && isAllowedImageReference(target) ? trimmed : null;
	}
	if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
		if (!isAllowedImageReference(trimmed)) {
			return null;
		}
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

export function sanitizeSlideImageMarkdown(markdown: string): string {
	if (!markdown) {
		return markdown;
	}
	return markdown
		.replace(INLINE_MARKDOWN_IMAGE_PATTERN, (_match: string, alt: string, rawTarget: string, title: string) => {
			const target = stripMarkdownTargetBrackets(rawTarget);
			return isAllowedImageReference(target) ? `![${alt}](${rawTarget}${title})` : alt;
		})
		.replace(INLINE_EMBED_IMAGE_PATTERN, (match: string, target: string) =>
			isAllowedImageReference(target) ? match : ''
		);
}

function isImagePath(value: string): boolean {
	const normalized = value.trim();
	if (!normalized || normalized.includes('\n')) {
		return false;
	}
	if (MARKDOWN_IMAGE_PATTERN.test(normalized)) {
		const target = extractMarkdownImageTarget(normalized);
		return Boolean(target && isAllowedImageReference(target));
	}
	if (EMBED_IMAGE_PATTERN.test(normalized)) {
		const target = extractEmbedImageTarget(normalized);
		return Boolean(target && isAllowedImageReference(target));
	}
	if (/^data:image\//i.test(normalized)) {
		return isAllowedDataImageUri(normalized);
	}
	const wikilinkMatch = normalized.match(WIKILINK_PATTERN);
	if (wikilinkMatch && wikilinkMatch[1]) {
		return hasImageExtension(wikilinkMatch[1]);
	}
	if (IMAGE_PATH_PATTERN.test(normalized)) {
		return isAllowedImageReference(normalized);
	}
	return hasImageExtension(normalized);
}

function hasImageExtension(value: string): boolean {
	const lower = stripUrlSuffix(stripAlias(value)).toLowerCase();
	return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

function isAllowedImageReference(value: string): boolean {
	const normalized = value.trim();
	if (!normalized || normalized.includes('\n')) {
		return false;
	}
	if (/^data:image\//i.test(normalized)) {
		return isAllowedDataImageUri(normalized);
	}
	const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/i);
	if (scheme) {
		return isAllowedRemoteImageUrl(normalized);
	}
	return isImagePathWithoutScheme(normalized);
}

function isAllowedRemoteImageUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function isAllowedDataImageUri(value: string): boolean {
	if (value.length > MAX_DATA_IMAGE_URI_LENGTH) {
		return false;
	}
	const match = value.match(/^data:([^;,]+)((?:;[a-z0-9.+-]+(?:=[a-z0-9.+-]+)?)*)?,([a-z0-9+/=\r\n]+)$/i);
	if (!match) {
		return false;
	}
	const mimeType = match[1].toLowerCase();
	const parameters = match[2] ?? '';
	return SAFE_DATA_IMAGE_MIME_TYPES.has(mimeType) && /(?:^|;)base64(?:;|$)/i.test(parameters);
}

function isImagePathWithoutScheme(value: string): boolean {
	const normalized = stripAlias(value.trim());
	if (!normalized || normalized.includes('\n')) {
		return false;
	}
	return hasImageExtension(normalized);
}

function extractMarkdownImageTarget(markdown: string): string | null {
	const match = markdown.match(/^!\[[^\]]*]\((<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)$/);
	return match && match[1] ? stripMarkdownTargetBrackets(match[1]) : null;
}

function extractEmbedImageTarget(markdown: string): string | null {
	const match = markdown.match(EMBED_IMAGE_PATTERN);
	if (!match) {
		return null;
	}
	return stripAlias(markdown.slice(3, -2).trim());
}

function stripMarkdownTargetBrackets(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function stripAlias(value: string): string {
	const separator = value.indexOf('|');
	return separator >= 0 ? value.slice(0, separator).trim() : value.trim();
}

function stripUrlSuffix(value: string): string {
	const queryIndex = value.search(/[?#]/);
	return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
}
