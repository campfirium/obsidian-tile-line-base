export interface ColumnConfig {
	name: string;
	width?: string;
	unit?: string;
	formula?: string;
	hide?: boolean;
}

export interface H2Block {
	title: string;
	data: Record<string, string>;
}

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

				const config = this.parseColumnDefinition(trimmed);
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

		for (const line of lines) {
			const trimmed = line.trim();

			if (trimmed.startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				continue;
			}

			if (inCodeBlock) {
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
				const colonIndex = titleText.indexOf('：') >= 0 ? titleText.indexOf('：') : titleText.indexOf(':');
				if (colonIndex > 0) {
					const key = titleText.substring(0, colonIndex).trim();
					const value = titleText.substring(colonIndex + 1).trim();
					currentBlock.data[key] = value;
				}
			} else if (currentBlock) {
				if (trimmed.length > 0) {
					const colonIndex = trimmed.indexOf('：') >= 0 ? trimmed.indexOf('：') : trimmed.indexOf(':');
					if (colonIndex > 0) {
						const key = trimmed.substring(0, colonIndex).trim();
						const value = trimmed.substring(colonIndex + 1).trim();
						currentBlock.data[key] = value;
					}
				}
			}
		}

		if (currentBlock) {
			blocks.push(currentBlock);
		}

		return blocks;
	}

	parseColumnDefinition(line: string): ColumnConfig | null {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			return null;
		}

		const config: ColumnConfig = { name: '' };
		const length = trimmed.length;
		let index = 0;
		let nameBuilder = '';

		while (index < length) {
			const char = trimmed[index];
			if (char !== '(') {
				nameBuilder += char;
				index++;
				continue;
			}

			const closingIndex = this.findMatchingParenthesis(trimmed, index);
			if (closingIndex === -1) {
				nameBuilder += trimmed.slice(index);
				break;
			}

			const segment = trimmed.slice(index + 1, closingIndex).trim();
			if (this.isConfigSegment(segment)) {
				this.applyColumnConfigSegment(config, segment);
			} else {
				nameBuilder += trimmed.slice(index, closingIndex + 1);
			}

			index = closingIndex + 1;
		}

		const normalizedName = nameBuilder.trim();
		if (normalizedName.length === 0) {
			config.name = trimmed;
		} else {
			config.name = normalizedName.replace(/\s+/g, ' ');
		}

		if (config.name.length === 0) {
			return null;
		}

		return config;
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

	private applyColumnConfigSegment(config: ColumnConfig, segment: string): void {
		const colonIndex = segment.indexOf(':');
		if (colonIndex === -1) {
			if (segment.trim().toLowerCase() === 'hide') {
				config.hide = true;
			}
			return;
		}

		const key = segment.slice(0, colonIndex).trim();
		let value = segment.slice(colonIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		switch (key) {
			case 'width':
				config.width = value;
				break;
			case 'unit':
				config.unit = value;
				break;
			case 'formula':
				config.formula = value;
				break;
		}
	}

	private isConfigSegment(segment: string): boolean {
		if (!segment || segment.trim().length === 0) {
			return false;
		}
		const normalized = segment.trim().toLowerCase();
		if (normalized === 'hide') {
			return true;
		}
		const colonIndex = segment.indexOf(':');
		if (colonIndex === -1) {
			return false;
		}
		const key = segment.slice(0, colonIndex).trim().toLowerCase();
		return key === 'width' || key === 'unit' || key === 'formula';
	}

	private findMatchingParenthesis(source: string, startIndex: number): number {
		let depth = 0;
		for (let i = startIndex; i < source.length; i++) {
			const current = source[i];
			if (current === '(') {
				depth++;
			} else if (current === ')') {
				depth--;
				if (depth === 0) {
					return i;
				}
			}
		}
		return -1;
	}
}
