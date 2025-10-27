import type { DateFormatPreset } from '../utils/datetime';
import { parseColumnDefinition as parseColumnDefinitionLine } from './MarkdownColumnConfigParser';
import type { FormulaFormatPreset } from './formulaFormatPresets';
import {
	isCollapsedDataLine,
	isLegacyBlockStart,
	mergeCollapsedEntries,
	parseCollapsedDataLine,
	parseLegacyBlock,
	parseLegacyLabel,
	parseLegacySummaryLine,
	type CollapsedFieldEntry
} from './collapsed/CollapsedFieldCodec';

export type ColumnFieldDisplayType = 'text' | 'date';

export interface ColumnConfig {
	name: string;
	width?: string;
	unit?: string;
	formula?: string;
	hide?: boolean;
	type?: ColumnFieldDisplayType;
	dateFormat?: DateFormatPreset;
	formulaFormat?: FormulaFormatPreset;
}

export interface H2Block {
	title: string;
	data: Record<string, string>;
	collapsedFields?: CollapsedFieldEntry[];
}

const FULL_WIDTH_COLON = '\uFF1A';

export class MarkdownBlockParser {
	parseHeaderConfig(content: string): ColumnConfig[] | null {
		const blockRegex = /```(?:tlb|tilelinebase)\s*\n([\s\S]*?)\n```/gi;
		let match: RegExpExecArray | null;

		while ((match = blockRegex.exec(content)) !== null) {
			const blockContent = match[1];
			const blockStartIndex = match.index ?? 0;

			if (this.isRuntimeConfigBlock(content, blockStartIndex, blockContent)) {
				continue;
			}

			const lines = blockContent.split(/\r?\n/);
			const columnConfigs: ColumnConfig[] = [];

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.length === 0 || trimmed.startsWith('#')) {
					continue;
				}

				const config = parseColumnDefinitionLine(trimmed);
				if (config) {
					columnConfigs.push(config);
				}
			}

			if (columnConfigs.length > 0) {
				return columnConfigs;
			}
		}

		return null;
	}

	parseH2Blocks(content: string): H2Block[] {
		const configBlockRegex = /^## tlb \w+ \d+[\s\S]*$/m;
		const contentWithoutConfig = content.replace(configBlockRegex, '');
		const lines = contentWithoutConfig.split('\n');
		const blocks: H2Block[] = [];
		let currentBlock: H2Block | null = null;
		let inCodeBlock = false;

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			const trimmed = line.trim();

			if (!inCodeBlock && currentBlock) {
				if (isCollapsedDataLine(trimmed)) {
					const entries = parseCollapsedDataLine(trimmed);
					mergeCollapsedEntries(currentBlock, entries);
					continue;
				}
				const legacySummaryEntries = parseLegacySummaryLine(trimmed);
				if (legacySummaryEntries.length > 0) {
					mergeCollapsedEntries(currentBlock, legacySummaryEntries);
					continue;
				}
				if (parseLegacyLabel(trimmed) !== null) {
					continue;
				}
				if (isLegacyBlockStart(trimmed)) {
					const legacyResult = parseLegacyBlock(lines, index);
					if (legacyResult) {
						mergeCollapsedEntries(currentBlock, legacyResult.entries);
						index = legacyResult.endIndex;
						continue;
					}
				}
			}

			if (trimmed.startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				continue;
			}

			if (inCodeBlock) {
				continue;
			}

			if (trimmed.length === 0) {
				continue;
			}

			if (trimmed.startsWith('## ')) {
				if (currentBlock) {
					blocks.push(currentBlock);
				}
				const titleText = trimmed.substring(3).trim();
				currentBlock = {
					title: titleText,
					data: {}
				};
				const colonIndex = resolveColonIndex(titleText);
				if (colonIndex > 0) {
					const key = titleText.substring(0, colonIndex).trim();
					const value = titleText.substring(colonIndex + 1).trim();
					currentBlock.data[key] = value;
				}
				continue;
			}

			if (!currentBlock) {
				continue;
			}

			const colonIndex = resolveColonIndex(trimmed);
			if (colonIndex > 0) {
				const key = trimmed.substring(0, colonIndex).trim();
				const value = trimmed.substring(colonIndex + 1).trim();
				currentBlock.data[key] = value;
			}
		}

		if (currentBlock) {
			blocks.push(currentBlock);
		}

		return blocks;
	}

	parseColumnDefinition(line: string): ColumnConfig | null {
		return parseColumnDefinitionLine(line);
	}

	private isRuntimeConfigBlock(content: string, blockStartIndex: number, blockContent: string): boolean {
		const preceding = content.slice(0, blockStartIndex).replace(/\r/g, '');
		let headingLine = '';
		const lastHeadingStart = preceding.lastIndexOf('\n## ');

		if (lastHeadingStart >= 0) {
			const headingStart = lastHeadingStart + 1;
			const headingEnd = preceding.indexOf('\n', headingStart);
			headingLine = preceding
				.slice(headingStart, headingEnd === -1 ? preceding.length : headingEnd)
				.trim();
		} else if (preceding.startsWith('## ')) {
			const firstLineEnd = preceding.indexOf('\n');
			headingLine = (firstLineEnd === -1 ? preceding : preceding.slice(0, firstLineEnd)).trim();
		}

		const runtimeHeadingPattern = /^##\s+tlb\s+[A-Za-z0-9-]{4,}\s+\d+$/;
		if (headingLine && runtimeHeadingPattern.test(headingLine)) {
			return true;
		}

		const firstContentLine = blockContent
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line.length > 0 && !line.startsWith('#'));

		if (!firstContentLine) {
			return false;
		}

		const runtimeKeyPattern = /^(filterViews|columnWidths|viewPreference|__meta__)\b/i;
		return runtimeKeyPattern.test(firstContentLine);
	}
}

function resolveColonIndex(text: string): number {
	const fullWidthIndex = text.indexOf(FULL_WIDTH_COLON);
	return fullWidthIndex >= 0 ? fullWidthIndex : text.indexOf(':');
}
