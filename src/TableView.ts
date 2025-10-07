import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

export const TABLE_VIEW_TYPE = "tile-line-base-table";

interface TableViewState extends Record<string, unknown> {
	filePath: string;
}

// H2 块数据结构
interface H2Block {
	title: string;        // H2 标题（去掉 ## ）
	paragraphs: string[]; // 段落数组
}

// Schema（表格结构）
interface Schema {
	columnNames: string[]; // 所有列名
}

export class TableView extends ItemView {
	file: TFile | null = null;
	private blocks: H2Block[] = [];
	private schema: Schema | null = null;
	private saveTimeout: NodeJS.Timeout | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return TABLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename || "TileLineBase 表格";
	}

	async setState(state: TableViewState, result: any): Promise<void> {
		// 根据文件路径获取文件对象
		const file = this.app.vault.getAbstractFileByPath(state.filePath);
		if (file instanceof TFile) {
			this.file = file;
			await this.render();
		}
	}

	getState(): TableViewState {
		return {
			filePath: this.file?.path || ""
		};
	}

	/**
	 * 解析文件内容，提取所有 H2 块
	 */
	private parseH2Blocks(content: string): H2Block[] {
		const lines = content.split('\n');
		const blocks: H2Block[] = [];
		let currentBlock: H2Block | null = null;

		for (const line of lines) {
			// 检测 H2 标题
			if (line.startsWith('## ')) {
				// 保存前一个块
				if (currentBlock) {
					blocks.push(currentBlock);
				}
				// 开始新块
				currentBlock = {
					title: line.substring(3).trim(), // 去掉 "## "
					paragraphs: []
				};
			} else if (currentBlock) {
				// 在 H2 块内部，收集非空行作为段落
				const trimmed = line.trim();
				if (trimmed.length > 0) {
					currentBlock.paragraphs.push(line);
				}
			}
			// 如果还没遇到 H2，忽略该行
		}

		// 保存最后一个块
		if (currentBlock) {
			blocks.push(currentBlock);
		}

		return blocks;
	}

	/**
	 * 从第一个 H2 块提取 Schema
	 */
	private extractSchema(blocks: H2Block[]): Schema | null {
		if (blocks.length === 0) {
			return null;
		}

		const firstBlock = blocks[0];
		const columnNames = [
			firstBlock.title,           // 第一列名 = H2 标题
			...firstBlock.paragraphs    // 后续列名 = 段落
		];

		return { columnNames };
	}

	/**
	 * 从 H2 块提取表格数据
	 */
	private extractTableData(blocks: H2Block[], schema: Schema): string[][] {
		const data: string[][] = [];

		// 从第二个块开始（第一个是模板）
		for (let i = 1; i < blocks.length; i++) {
			const block = blocks[i];
			const row: string[] = [block.title]; // 第一列 = H2 标题

			// 添加段落作为后续列
			for (let j = 0; j < schema.columnNames.length - 1; j++) {
				const paragraph = block.paragraphs[j];
				// 空段落或 "." 表示空值
				if (!paragraph || paragraph.trim() === '.') {
					row.push('');
				} else {
					row.push(paragraph.trim());
				}
			}

			data.push(row);
		}

		return data;
	}

	/**
	 * 将 blocks 数组转换回 Markdown 格式
	 */
	private blocksToMarkdown(): string {
		const lines: string[] = [];

		for (const block of this.blocks) {
			// H2 标题
			lines.push(`## ${block.title}`);

			// 段落（非空才添加）
			for (const paragraph of block.paragraphs) {
				if (paragraph.trim()) {
					lines.push(paragraph);
				}
			}

			// H2 块之间空一行
			lines.push('');
		}

		return lines.join('\n');
	}

	/**
	 * 调度保存（500ms 防抖）
	 */
	private scheduleSave(): void {
		// 清除之前的定时器
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}

		// 500ms 后保存
		this.saveTimeout = setTimeout(() => {
			this.saveToFile();
		}, 500);
	}

	/**
	 * 保存到文件
	 */
	private async saveToFile(): Promise<void> {
		if (!this.file) return;

		try {
			const markdown = this.blocksToMarkdown();
			await this.app.vault.modify(this.file, markdown);
			console.log('✅ 文件已保存:', this.file.path);
		} catch (error) {
			console.error('❌ 保存失败:', error);
		}
	}

	async onOpen(): Promise<void> {
		// 初始化容器
		const container = this.containerEl.children[1];
		container.addClass("tile-line-base-view");
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();

		if (!this.file) {
			container.createDiv({ text: "未选择文件" });
			return;
		}

		// 读取文件内容
		const content = await this.app.vault.read(this.file);

		// 解析 H2 块
		this.blocks = this.parseH2Blocks(content);

		if (this.blocks.length === 0) {
			container.createDiv({
				text: "此文件不包含 H2 块，无法显示为表格",
				cls: "tlb-warning"
			});
			return;
		}

		// 提取 Schema
		this.schema = this.extractSchema(this.blocks);
		if (!this.schema) {
			container.createDiv({ text: "无法提取表格结构" });
			return;
		}

		// 提取数据
		const data = this.extractTableData(this.blocks, this.schema);

		// 创建表格容器
		const tableContainer = container.createDiv({ cls: "tlb-table-container" });
		const table = tableContainer.createEl("table", { cls: "tlb-table" });

		// 创建表头
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		this.schema.columnNames.forEach((colName: string) => {
			headerRow.createEl("th", { text: colName });
		});

		// 创建表体
		const tbody = table.createEl("tbody");
		data.forEach((row, rowIndex) => {
			const tr = tbody.createEl("tr");
			row.forEach((cellValue, colIndex) => {
				const td = tr.createEl("td");
				td.textContent = cellValue || "";
				td.setAttribute("contenteditable", "true");
				td.setAttribute("data-row", String(rowIndex));
				td.setAttribute("data-col", String(colIndex));

				// 监听按键事件
				td.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						td.blur(); // 失焦以触发保存
					}
				});

				// 监听失焦事件 - 保存编辑
				td.addEventListener("blur", () => {
					const newValue = td.textContent || "";
					this.onCellEdit(rowIndex, colIndex, newValue);
				});
			});
		});

		console.log(`TileLineBase 表格已渲染：${this.file.path}`);
		console.log(`Schema:`, this.schema);
		console.log(`数据行数: ${data.length}`);
	}

	/**
	 * 处理单元格编辑
	 */
	private onCellEdit(rowIndex: number, colIndex: number, newValue: string): void {
		// rowIndex 是数据行索引，对应 blocks[rowIndex + 1]（因为 blocks[0] 是模板）
		const blockIndex = rowIndex + 1;

		if (blockIndex >= this.blocks.length) {
			console.error('Invalid block index:', blockIndex);
			return;
		}

		const block = this.blocks[blockIndex];

		if (colIndex === 0) {
			// 第一列：更新 H2 标题
			block.title = newValue;
			console.log(`更新 H2 标题 [${blockIndex}]:`, newValue);
		} else {
			// 其他列：更新段落
			const paragraphIndex = colIndex - 1;

			// 确保段落数组足够长
			while (block.paragraphs.length <= paragraphIndex) {
				block.paragraphs.push('');
			}

			block.paragraphs[paragraphIndex] = newValue;
			console.log(`更新段落 [${blockIndex}][${paragraphIndex}]:`, newValue);
		}

		// 打印更新后的 blocks 数组
		console.log('Updated blocks:', this.blocks);

		// 触发保存
		this.scheduleSave();
	}

	async onClose(): Promise<void> {
		// 清理工作
	}
}
