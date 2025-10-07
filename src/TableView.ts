import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { GridAdapter, ColumnDef, RowData } from "./grid/GridAdapter";
import { AgGridAdapter } from "./grid/AgGridAdapter";

export const TABLE_VIEW_TYPE = "tile-line-base-table";

interface TableViewState extends Record<string, unknown> {
	filePath: string;
}

// H2 块数据结构（Key:Value 格式）
interface H2Block {
	title: string;                 // H2 标题（去掉 ## ）
	data: Record<string, string>;  // Key-Value 键值对
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
	private contextMenu: HTMLElement | null = null;

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
	 * 解析文件内容，提取所有 H2 块（Key:Value 格式）
	 * H2 标题本身也可能是 Key:Value 格式
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

				// 解析 H2 标题（去掉 "## "）
				const titleText = line.substring(3).trim();

				// 开始新块
				currentBlock = {
					title: titleText,
					data: {}
				};

				// 如果 H2 标题包含冒号，解析为第一个键值对
				const colonIndex = titleText.indexOf('：') >= 0 ? titleText.indexOf('：') : titleText.indexOf(':');
				if (colonIndex > 0) {
					const key = titleText.substring(0, colonIndex).trim();
					const value = titleText.substring(colonIndex + 1).trim();
					currentBlock.data[key] = value;
				}
			} else if (currentBlock) {
				// 在 H2 块内部，解析 Key:Value 格式
				const trimmed = line.trim();
				if (trimmed.length > 0) {
					// 查找第一个冒号（支持中文冒号和英文冒号）
					const colonIndex = trimmed.indexOf('：') >= 0 ? trimmed.indexOf('：') : trimmed.indexOf(':');
					if (colonIndex > 0) {
						const key = trimmed.substring(0, colonIndex).trim();
						const value = trimmed.substring(colonIndex + 1).trim();
						currentBlock.data[key] = value;
					}
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
	 * 动态扫描所有 H2 块，提取 Schema
	 * 保留键的顺序：按照第一次出现的顺序排列
	 */
	private extractSchema(blocks: H2Block[]): Schema | null {
		if (blocks.length === 0) {
			return null;
		}

		// 使用数组保持顺序，同时用 Set 去重
		const columnNames: string[] = [];
		const seenKeys = new Set<string>();

		// 遍历所有块，按顺序收集 key
		for (const block of blocks) {
			for (const key of Object.keys(block.data)) {
				if (!seenKeys.has(key)) {
					columnNames.push(key);
					seenKeys.add(key);
				}
			}
		}

		return { columnNames };
	}

	/**
	 * 从 H2 块提取表格数据（转换为 RowData 格式）
	 */
	private extractTableData(blocks: H2Block[], schema: Schema): RowData[] {
		const data: RowData[] = [];

		// 所有块都是数据（没有模板H2）
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i];
			const row: RowData = {};

			// 序号列（从 1 开始）
			row['#'] = String(i + 1);

			// 所有列都从 block.data 提取
			for (const key of schema.columnNames) {
				row[key] = block.data[key] || '';
			}

			data.push(row);
		}

		return data;
	}

	/**
	 * 将 blocks 数组转换回 Markdown 格式（Key:Value）
	 * 第一个 key:value 作为 H2 标题，其余作为正文
	 */
	private blocksToMarkdown(): string {
		if (!this.schema) return '';

		const lines: string[] = [];

		for (const block of this.blocks) {
			// 按照 schema 顺序输出
			let isFirstKey = true;

			for (const key of this.schema.columnNames) {
				const value = block.data[key] || '';

				if (isFirstKey) {
					// 第一个 key:value 作为 H2 标题
					lines.push(`## ${key}：${value}`);
					isFirstKey = false;
				} else {
					// 其他 key:value 作为正文
					if (value.trim()) {
						lines.push(`${key}：${value}`);
					} else {
						// 空值也要保留，确保 Schema 完整性
						lines.push(`${key}：`);
					}
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

		// 准备列定义（添加序号列）
		const columns: ColumnDef[] = [
			{
				field: '#',
				headerName: '#',
				editable: false  // 序号列只读
			},
			...this.schema.columnNames.map(name => ({
				field: name,
				headerName: name,
				editable: true
			}))
		];

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

		// 添加右键菜单监听
		this.setupContextMenu(tableContainer);

		// 添加键盘快捷键
		this.setupKeyboardShortcuts(tableContainer);

		console.log(`TileLineBase 表格已渲染（AG Grid）：${this.file.path}`);
		console.log(`Schema:`, this.schema);
		console.log(`数据行数: ${data.length}`);
	}

	/**
	 * 设置右键菜单
	 */
	private setupContextMenu(tableContainer: HTMLElement): void {
		// 监听右键点击
		tableContainer.addEventListener('contextmenu', (event) => {
			event.preventDefault();

			// 获取点击的行索引
			const rowIndex = this.gridAdapter?.getRowIndexFromEvent(event);
			if (rowIndex === null || rowIndex === undefined) return;

			// 显示自定义菜单
			this.showContextMenu(event, rowIndex);
		});

		// 点击其他地方隐藏菜单
		document.addEventListener('click', () => {
			this.hideContextMenu();
		});
	}

	/**
	 * 设置键盘快捷键
	 */
	private setupKeyboardShortcuts(tableContainer: HTMLElement): void {
		tableContainer.addEventListener('keydown', (event) => {
			// 如果正在编辑单元格，不触发快捷键
			const activeElement = document.activeElement;
			if (activeElement?.classList.contains('ag-cell-edit-input')) {
				return;
			}

			const selectedRows = this.gridAdapter?.getSelectedRows() || [];
			const hasSelection = selectedRows.length > 0;
			const firstSelectedRow = hasSelection ? selectedRows[0] : null;

			// Enter: 添加新行
			if (event.key === 'Enter') {
				event.preventDefault();
				if (hasSelection && firstSelectedRow !== null) {
					// 在选中行之后添加
					this.addRow(firstSelectedRow + 1);
				} else {
					// 在末尾添加
					this.addRow();
				}
				return;
			}

			// Cmd+D / Ctrl+D: 复制行
			if ((event.metaKey || event.ctrlKey) && event.key === 'd') {
				event.preventDefault();
				if (hasSelection && firstSelectedRow !== null) {
					this.duplicateRow(firstSelectedRow);
				}
				return;
			}

			// Delete / Backspace: 删除行
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				if (hasSelection && firstSelectedRow !== null) {
					this.deleteRow(firstSelectedRow);
				}
				return;
			}
		});
	}

	/**
	 * 显示右键菜单
	 */
	private showContextMenu(event: MouseEvent, rowIndex: number): void {
		// 移除旧菜单
		this.hideContextMenu();

		// 创建菜单容器
		this.contextMenu = document.body.createDiv({ cls: 'tlb-context-menu' });

		// 在上方插入行
		const insertAbove = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
		insertAbove.createSpan({ text: '在上方插入行' });
		insertAbove.addEventListener('click', () => {
			this.addRow(rowIndex);  // 在当前行之前插入
			this.hideContextMenu();
		});

		// 在下方插入行
		const insertBelow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
		insertBelow.createSpan({ text: '在下方插入行' });
		insertBelow.addEventListener('click', () => {
			this.addRow(rowIndex + 1);  // 在当前行之后插入
			this.hideContextMenu();
		});

		// 分隔线
		this.contextMenu.createDiv({ cls: 'tlb-context-menu-separator' });

		// 删除此行
		const deleteRow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item tlb-context-menu-item-danger' });
		deleteRow.createSpan({ text: '删除此行' });
		deleteRow.addEventListener('click', () => {
			this.deleteRow(rowIndex);
			this.hideContextMenu();
		});

		// 定位菜单
		this.contextMenu.style.left = `${event.pageX}px`;
		this.contextMenu.style.top = `${event.pageY}px`;
	}

	/**
	 * 隐藏右键菜单
	 */
	private hideContextMenu(): void {
		if (this.contextMenu) {
			this.contextMenu.remove();
			this.contextMenu = null;
		}
	}

	/**
	 * 处理单元格编辑（Key:Value 格式）
	 */
	private onCellEdit(rowIndex: number, field: string, newValue: string): void {
		console.log('📝 TableView onCellEdit called:', { rowIndex, field, newValue });

		// 序号列不可编辑，直接返回
		if (field === '#') {
			console.log('⚠️ Ignoring edit on order column');
			return;
		}

		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		// rowIndex 直接对应 blocks[rowIndex]（没有模板H2）
		if (rowIndex < 0 || rowIndex >= this.blocks.length) {
			console.error('Invalid row index:', rowIndex);
			return;
		}

		const block = this.blocks[rowIndex];

		// 所有列都更新 data[key]
		block.data[field] = newValue;
		console.log(`更新数据 [${rowIndex}][${field}]:`, newValue);

		// 打印更新后的 blocks 数组
		console.log('Updated blocks:', this.blocks);

		// 触发保存
		this.scheduleSave();
	}

	/**
	 * 处理表头编辑（Key:Value 格式）
	 * 重命名列名（key）
	 */
	private onHeaderEdit(colIndex: number, newValue: string): void {
		if (!this.schema || this.blocks.length === 0) {
			console.error('Invalid schema or blocks');
			return;
		}

		const oldKey = this.schema.columnNames[colIndex];

		// 更新 schema
		this.schema.columnNames[colIndex] = newValue;

		// 遍历所有 blocks，重命名 key
		for (const block of this.blocks) {
			if (oldKey in block.data) {
				const value = block.data[oldKey];
				delete block.data[oldKey];
				block.data[newValue] = value;
			}
		}

		console.log(`✅ 列重命名: "${oldKey}" → "${newValue}"`);

		// 触发保存
		this.scheduleSave();
	}

	// ==================== 预留：CRUD 操作接口（SchemaStore 架构） ====================
	// 这些方法签名为未来的 SchemaStore 集成预留接口，减少后续重构成本

	/**
	 * 添加新行（Key:Value 格式）
	 * @param beforeRowIndex 在指定行索引之前插入，undefined 表示末尾
	 */
	private addRow(beforeRowIndex?: number): void {
		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		// 计算新条目编号
		const entryNumber = this.blocks.length + 1;

		// 创建新 H2Block（初始化所有 key）
		const newBlock: H2Block = {
			title: '',  // title 会在 blocksToMarkdown 时重新生成
			data: {}
		};

		// 为所有列初始化值
		for (let i = 0; i < this.schema.columnNames.length; i++) {
			const key = this.schema.columnNames[i];
			// 第一列使用"新条目 X"，其他列为空
			newBlock.data[key] = (i === 0) ? `新条目 ${entryNumber}` : '';
		}

		if (beforeRowIndex !== undefined && beforeRowIndex !== null) {
			// 在指定行之前插入（rowIndex 直接对应 blocks 索引）
			this.blocks.splice(beforeRowIndex, 0, newBlock);
			console.log(`✅ 在行 ${beforeRowIndex} 之前插入新行`);
		} else {
			// 在末尾插入
			this.blocks.push(newBlock);
			console.log(`✅ 在末尾添加新行`);
		}

		// 更新 AG Grid 显示
		const data = this.extractTableData(this.blocks, this.schema);
		this.gridAdapter?.updateData(data);

		// 触发保存
		this.scheduleSave();
	}

	/**
	 * 删除指定行（Key:Value 格式）
	 * @param rowIndex 数据行索引
	 */
	private deleteRow(rowIndex: number): void {
		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		// 边界检查（rowIndex 直接对应 blocks 索引）
		if (rowIndex < 0 || rowIndex >= this.blocks.length) {
			console.error('Invalid row index:', rowIndex);
			return;
		}

		const targetBlock = this.blocks[rowIndex];

		// 确认对话框
		const confirmMessage = `确定要删除这一行吗？\n\n"${targetBlock.title}"`;
		if (!confirm(confirmMessage)) {
			console.log('❌ 用户取消删除');
			return;
		}

		// 删除块
		const deletedBlock = this.blocks.splice(rowIndex, 1)[0];

		// 更新 AG Grid 显示
		const data = this.extractTableData(this.blocks, this.schema);
		this.gridAdapter?.updateData(data);

		// 触发保存
		this.scheduleSave();

		console.log(`✅ 删除行：${deletedBlock.title}`);
	}

	/**
	 * 复制指定行（Key:Value 格式）
	 * @param rowIndex 数据行索引
	 */
	private duplicateRow(rowIndex: number): void {
		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		// 边界检查（rowIndex 直接对应 blocks 索引）
		if (rowIndex < 0 || rowIndex >= this.blocks.length) {
			console.error('Invalid row index:', rowIndex);
			return;
		}

		// 深拷贝目标块
		const sourceBlock = this.blocks[rowIndex];
		const duplicatedBlock: H2Block = {
			title: sourceBlock.title,
			data: { ...sourceBlock.data }
		};

		// 在源块之后插入复制的块
		this.blocks.splice(rowIndex + 1, 0, duplicatedBlock);

		// 更新 AG Grid 显示
		const data = this.extractTableData(this.blocks, this.schema);
		this.gridAdapter?.updateData(data);

		// 触发保存
		this.scheduleSave();

		console.log(`✅ 复制行：${duplicatedBlock.title}`);
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
