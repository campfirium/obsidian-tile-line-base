export interface FrontmatterExtractionResult {
	frontmatter: string | null;
	body: string;
	padding: string;
}

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*/;

export function extractFrontmatter(content: string): FrontmatterExtractionResult {
	const match = content.match(FRONTMATTER_PATTERN);
	if (!match) {
		return { frontmatter: null, body: content, padding: '' };
	}

	const frontmatter = match[0].trimEnd();
	const remainder = content.slice(match[0].length);
	const paddingMatch = remainder.match(/^[ \t]*\r?\n+/);
	const padding = paddingMatch ? paddingMatch[0].replace(/\r\n/g, '\n') : '\n';
	const body = remainder.slice(paddingMatch ? paddingMatch[0].length : 0);

	return {
		frontmatter,
		body,
		padding
	};
}
