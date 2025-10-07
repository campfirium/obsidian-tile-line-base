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
		const blocks = this.parseH2Blocks(content);

		if (blocks.length === 0) {
			container.createDiv({
				text: "此文件不包含 H2 块，无法显示为表格",
				cls: "tlb-warning"
			});
			return;
		}

		// 提取 Schema
		const schema = this.extractSchema(blocks);
		if (!schema) {
			container.createDiv({ text: "无法提取表格结构" });
			return;
		}

		// 提取数据
		const data = this.extractTableData(blocks, schema);

		// 创建表格容器
		const tableContainer = container.createDiv({ cls: "tlb-table-container" });
		const table = tableContainer.createEl("table", { cls: "tlb-table" });

		// 创建表头
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		schema.columnNames.forEach(colName => {
			headerRow.createEl("th", { text: colName });
		});

		// 创建表体
		const tbody = table.createEl("tbody");
		data.forEach(row => {
			const tr = tbody.createEl("tr");
			row.forEach(cell => {
				tr.createEl("td", { text: cell || "" });
			});
		});

		console.log(`TileLineBase 表格已渲染：${this.file.path}`);
		console.log(`Schema:`, schema);
		console.log(`数据行数: ${data.length}`);
	}

	async onClose(): Promise<void> {
		// 清理工作
	}
}
