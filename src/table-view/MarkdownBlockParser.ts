import type { DateFormatPreset, TimeFormatPreset } from '../utils/datetime';
import { parseColumnDefinition as parseColumnDefinitionLine } from './MarkdownColumnConfigParser';
import { buildInvalidSection, isRuntimeConfigBlock, resolveColonIndex } from './MarkdownParseHelpers';
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
export interface StrayContentSection { startLine: number; endLine: number; text: string; }
export interface H2ParseResult {
	blocks: H2Block[];
	invalidSections: InvalidH2Section[];
	straySections: StrayContentSection[];
	leadingHeading?: string | null;
}
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
			if (isRuntimeConfigBlock(content, blockStartIndex, blockContent)) {
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
		const blocks: H2Block[] = []; const straySections: StrayContentSection[] = []; const invalidSections: InvalidH2Section[] = [];
		let leadingHeading: string | null = null;
		let currentBlock: H2Block | null = null;
		let inCodeBlock = false;
		let strayStart = -1;
		let strayBuffer: string[] = [];
		let skipUntil = -1;
		let skippedFirstH1 = false;
		const flushStray = (currentIndex: number): void => {
			if (strayStart === -1 || strayBuffer.length === 0) return;
			straySections.push({ startLine: strayStart, endLine: currentIndex - 1, text: strayBuffer.join('\n') });
			strayStart = -1;
			strayBuffer = [];
		};
		const appendStray = (lineIndex: number, lineValue: string): void => {
			if (lineIndex <= skipUntil) return;
			if (strayStart === -1) strayStart = lineIndex;
			strayBuffer.push(lineValue);
		};
		for (let index = 0; index < lines.length; index++) {
			if (index <= skipUntil) continue;
			const line = lines[index];
			const trimmed = line.trim();
			if (trimmed.startsWith('```')) {
				flushStray(index);
				inCodeBlock = !inCodeBlock;
				continue;
			}
			if (inCodeBlock) continue;
			if (!skippedFirstH1) {
				if (/^#\s/.test(trimmed)) {
					skippedFirstH1 = true;
					leadingHeading = line;
					continue;
				}
				if (lines[index + 1] !== undefined && /^=+$/.test(lines[index + 1].trim()) && trimmed.length > 0) {
					skippedFirstH1 = true;
					leadingHeading = `${line}\n${lines[index + 1]}`;
					skipUntil = Math.max(skipUntil, index + 1);
					continue;
				}
			}
			if (trimmed.length === 0) {
				if (strayStart != -1) appendStray(index, line);
				continue;
			}
			if (/^##(?!#)/.test(trimmed)) {
				flushStray(index);
				if (currentBlock) blocks.push(currentBlock);
				const titleText = trimmed.replace(/^##\s*/, '').trim();
				const colonIndex = resolveColonIndex(titleText);
				if (colonIndex <= 0) {
					const invalid = buildInvalidSection(lines, index, 'missingColon');
					invalidSections.push(invalid);
					skipUntil = Math.max(skipUntil, invalid.endLine);
					currentBlock = null;
					continue;
				}
				const parsedHeadingField = this.extractField(titleText, colonIndex);
				if (!parsedHeadingField || !parsedHeadingField.key || !parsedHeadingField.value) {
					const invalid = buildInvalidSection(lines, index, 'invalidField');
					invalidSections.push(invalid);
					skipUntil = Math.max(skipUntil, invalid.endLine);
					currentBlock = null;
					continue;
				}
				currentBlock = { title: titleText, data: { [parsedHeadingField.key]: parsedHeadingField.value } };
				continue;
			}
			if (!currentBlock) { appendStray(index, line); continue; }
			if (isCollapsedCalloutStart(trimmed)) {
				const result = parseCollapsedCallout(lines, index);
				if (result) {
					mergeCollapsedEntries(currentBlock, result.entries);
					index = result.endIndex;
					continue;
				}
			}
			if (isCollapsedDataLine(trimmed)) {
				mergeCollapsedEntries(currentBlock, parseCollapsedDataLine(trimmed));
				continue;
			}
			if (COLLAPSED_COMMENT_PREFIX.test(trimmed)) {
				const commentEntries = parseCollapsedCommentSource(trimmed);
				if (commentEntries.length > 0) mergeCollapsedEntries(currentBlock, commentEntries);
				continue;
			}
			const parsedField = this.extractField(trimmed);
			if (parsedField) {
				currentBlock.data[parsedField.key] = parsedField.value;
				flushStray(index + 1);
				continue;
			}
			appendStray(index, line);
		}
		if (currentBlock) blocks.push(currentBlock);
		flushStray(lines.length);
		if (straySections.length > 1) {
			straySections.sort((a, b) => a.startLine - b.startLine);
			const merged: StrayContentSection[] = [];
			for (const section of straySections) {
				const last = merged[merged.length - 1];
				if (last && section.startLine <= last.endLine) {
					last.endLine = Math.max(last.endLine, section.endLine);
					last.text = `${last.text}
${section.text}`;
				} else {
					merged.push({ ...section });
				}
			}
			return { blocks, invalidSections, straySections: merged, leadingHeading };
		}
		return { blocks, invalidSections, straySections, leadingHeading };
	}
	parseH2Blocks(content: string): H2Block[] { return this.parseH2(content).blocks; }
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
	parseColumnDefinition(line: string): ColumnConfig | null { return parseColumnDefinitionLine(line); }
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
}

