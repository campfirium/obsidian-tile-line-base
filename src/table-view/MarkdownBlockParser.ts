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
import { consumeTildeFencedBlock, isTildeFenceMarker } from './MultilineFieldCodec';
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
export interface H2ParseResult { blocks: H2Block[]; invalidSections: InvalidH2Section[]; straySections: StrayContentSection[]; }
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
		const blocks: H2Block[] = []; const straySections: StrayContentSection[] = []; const invalidSections: InvalidH2Section[] = [];
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
			if (!skippedFirstH1 && /^#\s/.test(trimmed)) {
				skippedFirstH1 = true;
				continue;
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
					const invalid = this.buildInvalidSection(lines, index, 'missingColon');
					invalidSections.push(invalid);
					skipUntil = Math.max(skipUntil, invalid.endLine);
					currentBlock = null;
					continue;
				}
				const parsedHeadingField = this.extractField(titleText, colonIndex);
				if (!parsedHeadingField || !parsedHeadingField.key) {
					const invalid = this.buildInvalidSection(lines, index, 'invalidField');
					invalidSections.push(invalid);
					skipUntil = Math.max(skipUntil, invalid.endLine);
					currentBlock = null;
					continue;
				}
				currentBlock = { title: titleText, data: { [parsedHeadingField.key]: parsedHeadingField.value } };
				if (isTildeFenceMarker(parsedHeadingField.value)) {
					const fenced = consumeTildeFencedBlock(lines, index, parsedHeadingField.value.trim());
					if (fenced) { currentBlock.data[parsedHeadingField.key] = fenced.value; index = fenced.endIndex; }
				} else if (!parsedHeadingField.value) {
					const nextFence = (lines[index + 1] ?? '').trim();
					const fenced = isTildeFenceMarker(nextFence) ? consumeTildeFencedBlock(lines, index + 1, nextFence) : null;
					if (fenced) { currentBlock.data[parsedHeadingField.key] = fenced.value; index = fenced.endIndex; }
					else { const invalid = this.buildInvalidSection(lines, index, 'invalidField'); invalidSections.push(invalid); skipUntil = Math.max(skipUntil, invalid.endLine); currentBlock = null; continue; }
				}
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
				if (isTildeFenceMarker(parsedField.value)) {
					const fenced = consumeTildeFencedBlock(lines, index, parsedField.value.trim());
					if (fenced) {
						currentBlock.data[parsedField.key] = fenced.value;
						index = fenced.endIndex;
						flushStray(index + 1);
						continue;
					}
				} else if (!parsedField.value) {
					const nextFence = (lines[index + 1] ?? '').trim();
					const fenced = isTildeFenceMarker(nextFence) ? consumeTildeFencedBlock(lines, index + 1, nextFence) : null;
					if (fenced) { currentBlock.data[parsedField.key] = fenced.value; index = fenced.endIndex; flushStray(index + 1); continue; }
				}
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
			return { blocks, invalidSections, straySections: merged };
		}
		return { blocks, invalidSections, straySections };
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
			if (parsedHeading.key.length === 0 || (parsedHeading.value.length === 0 && (block.data[parsedHeading.key] ?? '').trim().length === 0)) {
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
	private isRuntimeConfigBlock(content: string, blockStartIndex: number, blockContent: string): boolean {
		const preceding = content.slice(0, blockStartIndex).replace(/\r/g, '');
		let headingLine = '';
		const lastHeadingStart = preceding.lastIndexOf('\n## ');
		if (lastHeadingStart >= 0) {
			const headingStart = lastHeadingStart + 1;
			const headingEnd = preceding.indexOf('\n', headingStart);
			headingLine = preceding.slice(headingStart, headingEnd === -1 ? preceding.length : headingEnd).trim();
		} else if (preceding.startsWith('## ')) {
			const firstLineEnd = preceding.indexOf('\n');
			headingLine = (firstLineEnd === -1 ? preceding : preceding.slice(0, firstLineEnd)).trim();
		}
		if (headingLine && /^##\s+tlb\s+[A-Za-z0-9-]{4,}\s+\d+$/.test(headingLine)) return true;
		const firstContentLine =
			blockContent.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0 && !line.startsWith('#')) ?? '';
		return /^(filterViews|columnWidths|viewPreference|__meta__)\b/i.test(firstContentLine);
	}
	private buildInvalidSection(lines: string[], headingIndex: number, reason: InvalidH2Section['reason']): InvalidH2Section {
		let endIndex = headingIndex; let probeInCodeBlock = false;
		for (let i = headingIndex + 1; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed.startsWith('```')) probeInCodeBlock = !probeInCodeBlock;
			if (!probeInCodeBlock && /^##(?!#)/.test(trimmed)) break;
			endIndex = i;
		}
		return { startLine: headingIndex, endLine: endIndex, text: lines.slice(headingIndex, endIndex + 1).join('\n'), heading: lines[headingIndex] ?? '', reason };
	}
}
function resolveColonIndex(text: string): number {
	const asciiIndex = text.indexOf(':');
	const fullWidthIndex = text.indexOf(FULL_WIDTH_COLON);
	if (asciiIndex === -1) return fullWidthIndex;
	if (fullWidthIndex === -1) return asciiIndex;
	return Math.min(asciiIndex, fullWidthIndex);
}
