import type { DateFormatPreset, TimeFormatPreset } from '../utils/datetime';
import { parseColumnDefinition as parseColumnDefinitionLine } from './MarkdownColumnConfigParser';
import type { FormulaFormatPreset } from './formulaFormatPresets';
import {
	isCollapsedDataLine,
	isCollapsedCalloutStart,
	mergeCollapsedEntries,
	parseCollapsedDataLine,
	parseCollapsedCallout,
	parseCollapsedCommentSource,
	type CollapsedFieldEntry,
	COLLAPSED_COMMENT_KEY
} from './collapsed/CollapsedFieldCodec';

export type ColumnFieldDisplayType = 'text' | 'date' | 'time' | 'image';

export interface ColumnConfig {
	name: string;
	width?: string;
	unit?: string;
	formula?: string;
	hide?: boolean;
	type?: ColumnFieldDisplayType;
	dateFormat?: DateFormatPreset;
	timeFormat?: TimeFormatPreset;
	formulaFormat?: FormulaFormatPreset;
}

export interface H2Block {
	title: string;
	data: Record<string, string>;
	collapsedFields?: CollapsedFieldEntry[];
}

export interface InvalidH2Section {
	startLine: number;
	endLine: number;
	heading: string;
	text: string;
	reason: 'missingColon' | 'invalidField';
}

export interface H2ParseResult {
	blocks: H2Block[];
	invalidSections: InvalidH2Section[];
}

const FULL_WIDTH_COLON = '\uFF1A';
const COLLAPSED_COMMENT_PREFIX = new RegExp(`^<!--\\s*${COLLAPSED_COMMENT_KEY.replace(/\./g, '\\.')}`, 'i');

const LIST_OR_QUOTE_PREFIX = /^(?:[-*+]\s|\d+\.\s|>\s?)/;
const HEADING_PREFIX = /^#{1,6}\s/;
const TABLE_ROW_PREFIX = /^\|/;

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

	parseH2(content: string): H2ParseResult {
		const lines = content.split('\n');
		const blocks: H2Block[] = [];
		const invalidSections: InvalidH2Section[] = [];
		let currentBlock: H2Block | null = null;
		let inCodeBlock = false;

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			const trimmed = line.trim();

			if (trimmed.startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				continue;
			}

			if (inCodeBlock || trimmed.length === 0) {
				continue;
			}

			if (/^##(?!#)/.test(trimmed)) {
				if (currentBlock) {
					blocks.push(currentBlock);
				}
				const titleText = trimmed.replace(/^##\s*/, '').trim();
				const colonIndex = resolveColonIndex(titleText);
				if (colonIndex <= 0) {
					invalidSections.push(this.buildInvalidSection(lines, index, 'missingColon'));
					currentBlock = null;
					continue;
				}
				const parsedHeadingField = this.extractField(titleText, colonIndex);
				if (!parsedHeadingField || !parsedHeadingField.key || !parsedHeadingField.value) {
					invalidSections.push(this.buildInvalidSection(lines, index, 'invalidField'));
					currentBlock = null;
					continue;
				}
				currentBlock = {
					title: titleText,
					data: { [parsedHeadingField.key]: parsedHeadingField.value }
				};
				continue;
			}

			if (!currentBlock) {
				continue;
			}

			if (isCollapsedCalloutStart(trimmed)) {
				const result = parseCollapsedCallout(lines, index);
				if (result) {
					mergeCollapsedEntries(currentBlock, result.entries);
					index = result.endIndex;
					continue;
				}
			}
			if (isCollapsedDataLine(trimmed)) {
				const entries = parseCollapsedDataLine(trimmed);
				mergeCollapsedEntries(currentBlock, entries);
				continue;
			}

			if (COLLAPSED_COMMENT_PREFIX.test(trimmed)) {
				const commentEntries = parseCollapsedCommentSource(trimmed);
				if (commentEntries.length > 0) {
					mergeCollapsedEntries(currentBlock, commentEntries);
				}
				continue;
			}
			const parsedField = this.extractField(trimmed);
			if (parsedField) {
				currentBlock.data[parsedField.key] = parsedField.value;
			}
		}

		if (currentBlock) {
			blocks.push(currentBlock);
		}

		return { blocks, invalidSections };
	}

	parseH2Blocks(content: string): H2Block[] {
		return this.parseH2(content).blocks;
	}

	hasStructuredH2Blocks(blocks: H2Block[]): boolean {
		if (!blocks || blocks.length === 0) {
			return false;
		}

		let headingKey: string | null = null;
		for (const block of blocks) {
			const colonIndex = resolveColonIndex(block.title);
			if (colonIndex <= 0) {
				return false;
			}
			const parsedHeading = this.extractField(block.title, colonIndex);
			if (!parsedHeading) {
				return false;
			}
			if (parsedHeading.key.length === 0 || parsedHeading.value.length === 0) {
				return false;
			}
			if (headingKey === null) {
				headingKey = parsedHeading.key;
			} else if (parsedHeading.key !== headingKey) {
				return false;
			}
		}

		return true;
	}

	parseColumnDefinition(line: string): ColumnConfig | null {
		return parseColumnDefinitionLine(line);
	}

	private extractField(line: string, existingColonIndex?: number): { key: string; value: string } | null {
		if (!this.isFieldCandidateLine(line)) {
			return null;
		}
		const colonIndex = existingColonIndex !== undefined ? existingColonIndex : resolveColonIndex(line);
		if (colonIndex <= 0) {
			return null;
		}
		const commentIndex = line.indexOf('<!--');
		if (commentIndex >= 0 && colonIndex > commentIndex) {
			return null;
		}
		const key = line.substring(0, colonIndex).trim();
		if (!key) {
			return null;
		}
		const value = line.substring(colonIndex + 1).trim();
		return { key, value };
	}

	private isFieldCandidateLine(line: string): boolean {
		if (!line || line.length === 0) {
			return false;
		}
		if (LIST_OR_QUOTE_PREFIX.test(line)) {
			return false;
		}
		if (HEADING_PREFIX.test(line)) {
			return false;
		}
		if (TABLE_ROW_PREFIX.test(line)) {
			return false;
		}
		return true;
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
	private buildInvalidSection(lines: string[], headingIndex: number, reason: InvalidH2Section['reason']): InvalidH2Section {
		let endIndex = headingIndex;
		let probeInCodeBlock = false;
		for (let i = headingIndex + 1; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed.startsWith('```')) {
				probeInCodeBlock = !probeInCodeBlock;
			}
			if (!probeInCodeBlock && /^##(?!#)/.test(trimmed)) {
				break;
			}
			endIndex = i;
		}
		return {
			startLine: headingIndex,
			endLine: endIndex,
			text: lines.slice(headingIndex, endIndex + 1).join('\n'),
			heading: lines[headingIndex] ?? '',
			reason
		};
	}


}

function resolveColonIndex(text: string): number {
	const asciiIndex = text.indexOf(':');
	const fullWidthIndex = text.indexOf(FULL_WIDTH_COLON);

	if (asciiIndex === -1) {
		return fullWidthIndex;
	}

	if (fullWidthIndex === -1) {
		return asciiIndex;
	}

	return Math.min(asciiIndex, fullWidthIndex);
}
