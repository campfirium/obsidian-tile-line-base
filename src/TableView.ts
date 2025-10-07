import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { GridAdapter, ColumnDef, RowData } from "./grid/GridAdapter";
import { AgGridAdapter } from "./grid/AgGridAdapter";

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
	columnIds?: string[];  // 预留：稳定 ID 系统（用于 SchemaStore）
}

export class TableView extends ItemView {
	file: TFile | null = null;
	private blocks: H2Block[] = [];
	private schema: Schema | null = null;
	private saveTimeout: NodeJS.Timeout | null = null;
	private gridAdapter: GridAdapter | null = null;

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
	 * 从 H2 块提取表格数据（转换为 RowData 格式）
	 */
	private extractTableData(blocks: H2Block[], schema: Schema): RowData[] {
		const data: RowData[] = [];

		// 从第二个块开始（第一个是模板）
		for (let i = 1; i < blocks.length; i++) {
			const block = blocks[i];
			const row: RowData = {};

			// 第一列：H2 标题
			row[schema.columnNames[0]] = block.title;

			// 后续列：段落
			for (let j = 1; j < schema.columnNames.length; j++) {
				const paragraph = block.paragraphs[j - 1];
				// 空段落或 "." 表示空值
				if (!paragraph || paragraph.trim() === '.') {
					row[schema.columnNames[j]] = '';
				} else {
					row[schema.columnNames[j]] = paragraph.trim();
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

		// 准备列定义
		const columns: ColumnDef[] = this.schema.columnNames.map(name => ({
			field: name,
			headerName: name,
			editable: true
		}));

		// 根据 Obsidian 主题选择 AG Grid 主题
		const isDarkMode = document.body.classList.contains('theme-dark');
		const themeClass = isDarkMode ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

		// 创建表格容器
		const tableContainer = container.createDiv({ cls: `tlb-table-container ${themeClass}` });

		// 销毁旧的表格实例（如果存在）
		if (this.gridAdapter) {
			this.gridAdapter.destroy();
		}

		// 创建并挂载新的表格
		this.gridAdapter = new AgGridAdapter();
		this.gridAdapter.mount(tableContainer, columns, data);

		// 监听单元格编辑事件
		this.gridAdapter.onCellEdit((event) => {
			this.onCellEdit(event.rowIndex, event.field, event.newValue);
		});

		// 监听表头编辑事件（暂未实现）
		this.gridAdapter.onHeaderEdit((event) => {
			// TODO: 实现表头编辑
			console.log('表头编辑:', event);
		});

		console.log(`TileLineBase 表格已渲染（AG Grid）：${this.file.path}`);
		console.log(`Schema:`, this.schema);
		console.log(`数据行数: ${data.length}`);
	}

	/**
	 * 处理单元格编辑
	 */
	private onCellEdit(rowIndex: number, field: string, newValue: string): void {
		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		// rowIndex 是数据行索引，对应 blocks[rowIndex + 1]（因为 blocks[0] 是模板）
		const blockIndex = rowIndex + 1;

		if (blockIndex >= this.blocks.length) {
			console.error('Invalid block index:', blockIndex);
			return;
		}

		// 通过字段名找到列索引
		const colIndex = this.schema.columnNames.indexOf(field);
		if (colIndex === -1) {
			console.error('Invalid field:', field);
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

	/**
	 * 处理表头编辑
	 */
	private onHeaderEdit(colIndex: number, newValue: string): void {
		if (!this.schema || this.blocks.length === 0) {
			console.error('Invalid schema or blocks');
			return;
		}

		// 更新 schema
		this.schema.columnNames[colIndex] = newValue;

		// 更新模板块（blocks[0]）
		const templateBlock = this.blocks[0];
		if (colIndex === 0) {
			// 第一列：更新 H2 标题
			templateBlock.title = newValue;
			console.log(`更新表头（模板 H2 标题）[${colIndex}]:`, newValue);
		} else {
			// 其他列：更新段落
			const paragraphIndex = colIndex - 1;

			// 确保段落数组足够长
			while (templateBlock.paragraphs.length <= paragraphIndex) {
				templateBlock.paragraphs.push('');
			}

			templateBlock.paragraphs[paragraphIndex] = newValue;
			console.log(`更新表头（模板段落）[${paragraphIndex}]:`, newValue);
		}

		// 触发保存
		this.scheduleSave();
	}

	// ==================== 预留：CRUD 操作接口（SchemaStore 架构） ====================
	// 这些方法签名为未来的 SchemaStore 集成预留接口，减少后续重构成本

	/**
	 * 添加新行
	 * @param afterIndex 在指定索引后插入，undefined 表示末尾
	 * TODO: T0009 - 实现添加行功能
	 */
	private addRow(afterIndex?: number): void {
		console.warn('addRow not implemented yet. Coming in T0009.');
	}

	/**
	 * 删除指定行
	 * @param rowIndex 数据行索引（不包括模板行）
	 * TODO: T0009 - 实现删除行功能
	 */
	private deleteRow(rowIndex: number): void {
		console.warn('deleteRow not implemented yet. Coming in T0009.');
	}

	/**
	 * 复制指定行
	 * @param rowIndex 数据行索引
	 * TODO: T0009+ - 实现复制行功能
	 */
	private duplicateRow(rowIndex: number): void {
		console.warn('duplicateRow not implemented yet. Coming in T0009+.');
	}

	/**
	 * 添加新列
	 * @param afterColumnId 在指定列后插入
	 * TODO: T0010+ - 实现添加列功能（需要 columnId 系统）
	 */
	private addColumn(afterColumnId?: string): void {
		console.warn('addColumn not implemented yet. Coming in T0010+.');
	}

	/**
	 * 删除指定列
	 * @param columnId 列的稳定 ID
	 * TODO: T0010+ - 实现删除列功能（需要 columnId 系统）
	 */
	private deleteColumn(columnId: string): void {
		console.warn('deleteColumn not implemented yet. Coming in T0010+.');
	}

	/**
	 * 重命名列（通过 columnId）
	 * @param columnId 列的稳定 ID
	 * @param newName 新的列名
	 * TODO: T0010+ - 实现列重命名功能（需要 columnId 系统）
	 */
	private renameColumn(columnId: string, newName: string): void {
		console.warn('renameColumn not implemented yet. Coming in T0010+.');
	}

	async onClose(): Promise<void> {
		// 销毁表格实例
		if (this.gridAdapter) {
			this.gridAdapter.destroy();
			this.gridAdapter = null;
		}

		// 清理保存定时器
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
	}
}
