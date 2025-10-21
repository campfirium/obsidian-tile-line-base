import { App, ItemView, WorkspaceLeaf, TFile, EventRef, Menu, Modal, Setting, Notice } from "obsidian";
import { GridAdapter, ColumnDef, RowData, CellEditEvent, ROW_ID_FIELD } from "./grid/GridAdapter";
import { AgGridAdapter } from "./grid/AgGridAdapter";
import { TaskStatus } from "./renderers/StatusCellRenderer";
import { getPluginContext } from "./pluginContext";
import { clampColumnWidth } from "./grid/columnSizing";
import { getCurrentLocalDateTime } from "./utils/datetime";
import { debugLog } from "./utils/logger";
import type { ColumnState } from "ag-grid-community";
import type { FileFilterViewState, FilterViewDefinition, FilterRule, FilterCondition, FilterOperator } from "./types/filterView";

const LOG_PREFIX = "[TileLineBase]";

export const TABLE_VIEW_TYPE = "tile-line-base-table";

interface TableViewState extends Record<string, unknown> {
	filePath: string;
}

// H2 块数据结构（Key:Value 格式）
interface H2Block {
	title: string;                 // H2 标题（去掉 ## ）
	data: Record<string, string>;  // Key-Value 键值对
}

// 列配置（头部配置块）
interface ColumnConfig {
	name: string;           // 列名
	width?: string;         // 宽度："30%", "150px", "auto"
	unit?: string;          // 单位："分钟"
	formula?: string;       // 公式："= {价值}/{成本}"
	hide?: boolean;         // 是否隐藏
}

// Schema（表格结构）
interface Schema {
	columnNames: string[];            // 所有列名
	columnConfigs?: ColumnConfig[];   // 列配置（来自头部配置块）
	columnIds?: string[];             // 预留：稳定 ID 系统（用于 SchemaStore）
}

export class TableView extends ItemView {
	file: TFile | null = null;
	private blocks: H2Block[] = [];
	private schema: Schema | null = null;
	private saveTimeout: NodeJS.Timeout | null = null;
	private gridAdapter: GridAdapter | null = null;
	private allRowData: any[] = []; // 保存全部行数据
	private contextMenu: HTMLElement | null = null;
	private columnWidthPrefs: Record<string, number> | null = null;

	// 事件监听器引用（用于清理）
	private contextMenuHandler: ((event: MouseEvent) => void) | null = null;
	private documentClickHandler: (() => void) | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private windowResizeHandler: (() => void) | null = null;
	private tableContainer: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimeout: NodeJS.Timeout | null = null;
	private sizeCheckInterval: NodeJS.Timeout | null = null;
	private visualViewportResizeHandler: (() => void) | null = null;
	private visualViewportTarget: VisualViewport | null = null;
	private workspaceResizeRef: EventRef | null = null;
	private lastContainerWidth: number = 0;
	private lastContainerHeight: number = 0;
	private pendingSizeUpdateHandle: number | null = null;
	private filterViewBar: HTMLElement | null = null;
	private filterViewTabsEl: HTMLElement | null = null;
	private filterViewState: FileFilterViewState = { views: [], activeViewId: null };
	private initialColumnState: ColumnState[] | null = null;

	constructor(leaf: WorkspaceLeaf) {
		debugLog('=== TableView 构造函数开始 ===');
		debugLog('leaf:', leaf);
		super(leaf);
		debugLog('=== TableView 构造函数完成 ===');
	}

	getViewType(): string {
		return TABLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename || "TileLineBase 表格";
	}

	async setState(state: TableViewState, result: any): Promise<void> {
		debugLog('=== TableView.setState 开始 ===');
		debugLog('state:', state);
		try {
			// 根据文件路径获取文件对象
			const file = this.app.vault.getAbstractFileByPath(state.filePath);
			debugLog('file:', file);
			if (file instanceof TFile) {
				this.file = file;
				await this.render();
			}
			debugLog('=== TableView.setState 完成 ===');
		} catch (e) {
			console.error('=== TableView.setState 错误 ===', e);
			throw e;
		}
	}

	getState(): TableViewState {
		return {
			filePath: this.file?.path || ""
		};
	}

	/**
	 * 解析头部配置块（```tlb）
	 */
	private parseHeaderConfigBlock(content: string): ColumnConfig[] | null {
		// 匹配 ```tlb ... ``` 代码块
		const configBlockRegex = /```tlb\s*\n([\s\S]*?)\n```/;
		const match = content.match(configBlockRegex);

		if (!match) {
			return null; // 没有头部配置块
		}

		const configContent = match[1];
		const lines = configContent.split('\n');
		const columnConfigs: ColumnConfig[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.length === 0 || trimmed.startsWith('#')) {
				continue; // 跳过空行和注释
			}

			// 解析列定义：列名 (配置1) (配置2: 值)
			const config = this.parseColumnDefinition(trimmed);
			if (config) {
				columnConfigs.push(config);
			}
		}

		return columnConfigs;
	}

	/**
	 * 应用宽度配置到列定义
	 */
	private applyWidthConfig(colDef: ColumnDef, config: ColumnConfig): void {
		if (!config.width || config.width === 'auto') {
			// 没有定义宽度或明确指定 auto：根据内容自适应
			// 不设置 width 和 flex，AgGridAdapter 会智能判断
			return;
		}

		const width = config.width.trim();

		// 特殊关键字：flex（分配剩余空间）
		if (width === 'flex') {
			(colDef as any).flex = 1;
			(colDef as any).minWidth = 200;
			return;
		}

		// 百分比宽度：使用 flex 按比例分配
		if (width.endsWith('%')) {
			const percentage = parseInt(width.replace('%', ''));
			if (!isNaN(percentage)) {
				(colDef as any).flex = percentage;
			}
			return;
		}

		// 像素宽度：固定宽度
		if (width.endsWith('px')) {
			const pixels = parseInt(width.replace('px', ''));
			if (!isNaN(pixels)) {
				(colDef as any).width = pixels;
			}
			return;
		}

		// 尝试作为数字处理（默认像素）
		const num = parseInt(width);
		if (!isNaN(num)) {
			(colDef as any).width = num;
		}
	}

	private ensureColumnWidthPrefs(): Record<string, number> {
		if (this.columnWidthPrefs) {
			return this.columnWidthPrefs;
		}

		const plugin = getPluginContext();
		const filePath = this.file?.path;
		this.columnWidthPrefs = plugin && filePath ? { ...(plugin.getColumnLayout(filePath) ?? {}) } : {};
		return this.columnWidthPrefs;
	}

	private getStoredColumnWidth(field: string): number | undefined {
		const prefs = this.ensureColumnWidthPrefs();
		return prefs[field];
	}

	private handleColumnResize(field: string, width: number): void {
		if (!this.file) {
			return;
		}
		if (field === '#' || field === 'status') {
			return;
		}

		const clamped = clampColumnWidth(width);
		const prefs = this.ensureColumnWidthPrefs();
		prefs[field] = clamped;

		const plugin = getPluginContext();
		plugin?.updateColumnWidthPreference(this.file.path, field, clamped);
	}


	/**
	 * 解析单行列定义
	 * 格式：列名 (width: 30%) (unit: 分钟) (hide)
	 */
	private parseColumnDefinition(line: string): ColumnConfig | null {
		// 提取列名（第一个左括号之前的部分）
		const nameMatch = line.match(/^([^(]+)/);
		if (!nameMatch) return null;

		const name = nameMatch[1].trim();
		const config: ColumnConfig = { name };

		// 提取所有括号中的配置项
		const configRegex = /\(([^)]+)\)/g;
		let match;

		while ((match = configRegex.exec(line)) !== null) {
			const configStr = match[1].trim();

			// 判断是键值对还是布尔开关
			if (configStr.includes(':')) {
				// 键值对：width: 30%
				const [key, ...valueParts] = configStr.split(':');
				const value = valueParts.join(':').trim();

				switch (key.trim()) {
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
			} else {
				// 布尔开关：hide
				if (configStr === 'hide') {
					config.hide = true;
				}
			}
		}

		return config;
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
	 * 如果有头部配置块，优先使用配置块定义的列顺序
	 * 自动添加 status 为内置系统列
	 */
	private extractSchema(blocks: H2Block[], columnConfigs: ColumnConfig[] | null): Schema | null {
		if (blocks.length === 0) {
			return null;
		}

		let columnNames: string[];

		if (columnConfigs && columnConfigs.length > 0) {
			// 使用头部配置块定义的列顺序
			columnNames = columnConfigs.map(config => config.name);
		} else {
			// 没有配置块，动态扫描所有 key
			columnNames = [];
			const seenKeys = new Set<string>();

			for (const block of blocks) {
				for (const key of Object.keys(block.data)) {
					// 跳过压缩属性（statusChanged 等）
					if (key === 'statusChanged') continue;

					if (!seenKeys.has(key)) {
						columnNames.push(key);
						seenKeys.add(key);
					}
				}
			}
		}

		// 自动添加 status 为内置列（在第一个数据列之后，即第三列位置）
		// 如果 columnNames 中已经有 status，先移除
		const statusIndex = columnNames.indexOf('status');
		if (statusIndex !== -1) {
			columnNames.splice(statusIndex, 1);
		}

		// 在第二个位置插入 status（实际显示时：# -> 第一个数据列 -> status）
		// 如果没有数据列，就放在第一个位置
		const insertIndex = columnNames.length > 0 ? 1 : 0;
		columnNames.splice(insertIndex, 0, 'status');

		return {
			columnNames,
			columnConfigs: columnConfigs || undefined
		};
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
			row[ROW_ID_FIELD] = String(i);

			// 所有列都从 block.data 提取
			for (const key of schema.columnNames) {
				// 如果是 status 列，确保有默认值
				if (key === 'status' && !block.data[key]) {
					block.data[key] = 'todo';
					// 如果没有 statusChanged，也初始化
					if (!block.data['statusChanged']) {
						block.data['statusChanged'] = getCurrentLocalDateTime();
					}
				}

				row[key] = block.data[key] || '';
			}

			data.push(row);
		}

		return data;
	}

	/**
	 * 将 blocks 数组转换回 Markdown 格式（Key:Value）
	 * 第一个 key:value 作为 H2 标题，其余作为正文
	 * 输出压缩属性（statusChanged 等）
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

			// 输出压缩属性（不在 columnNames 中的属性）
			if (block.data['statusChanged']) {
				lines.push(`statusChanged：${block.data['statusChanged']}`);
			}

			// H2 块之间空一行
			lines.push('');
		}

		return lines.join('\n');
	}

	/**
	 * 将单个 H2 块转换为 Markdown 格式
	 * 用于复制整段功能，过滤掉空字段和系统字段
	 */
	private blockToMarkdown(block: H2Block): string {
		if (!this.schema) return '';

		const lines: string[] = [];
		let isFirstKey = true;

		// 系统字段列表（不复制这些字段）
		const systemFields = new Set(['status', 'statusChanged']);

		for (const key of this.schema.columnNames) {
			// 跳过系统字段
			if (systemFields.has(key)) {
				continue;
			}

			const value = block.data[key] || '';

			// 跳过空字段
			if (!value.trim()) {
				continue;
			}

			if (isFirstKey) {
				// 第一个 key:value 作为 H2 标题
				lines.push(`## ${key}：${value}`);
				isFirstKey = false;
			} else {
				// 其他 key:value 作为正文
				lines.push(`${key}：${value}`);
			}
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
		} catch (error) {
			console.error('❌ 保存失败:', error);
		}
	}

	async onOpen(): Promise<void> {
		debugLog('=== TableView.onOpen 开始 ===');
		try {
			// 初始化容器
			const container = this.containerEl.children[1];
			container.addClass("tile-line-base-view");

			// 支持 Pop-out 窗口的 Window Migration (Obsidian 0.15.3+)
			// 当视图被拖动到不同窗口时，需要重新渲染
			if (typeof (this.containerEl as any).onWindowMigrated === 'function') {
				(this.containerEl as any).onWindowMigrated(() => {
					debugLog('Window migrated, rebuilding view');
					// 重新构建视图以使用新窗口的上下文
					if (typeof (this.leaf as any).rebuildView === 'function') {
						(this.leaf as any).rebuildView();
					}
				});
			}

			debugLog('=== TableView.onOpen 完成 ===');
		} catch (e) {
			console.error('=== TableView.onOpen 错误 ===', e);
			throw e;
		}
	}

	async render(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();

		const ownerDoc = (container as HTMLElement).ownerDocument;
		const ownerWindow = ownerDoc?.defaultView ?? null;
		debugLog('TableView.render start', {
			file: this.file?.path,
			containerTag: (container as HTMLElement).tagName,
			containerClass: (container as HTMLElement).className,
			window: this.describeWindow(ownerWindow)
		});

		if (!this.file) {
			container.createDiv({ text: "未选择文件" });
			return;
		}

		this.columnWidthPrefs = null;
		// 读取文件内容
		const content = await this.app.vault.read(this.file);

		// 解析头部配置块
		const columnConfigs = this.parseHeaderConfigBlock(content);

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
		this.schema = this.extractSchema(this.blocks, columnConfigs);
		if (!this.schema) {
			container.createDiv({ text: "无法提取表格结构" });
			return;
		}

		// 提取数据
		const data = this.extractTableData(this.blocks, this.schema);
		this.allRowData = data; // 保存全部数据供过滤使用

		// 准备列定义（添加序号列）
		this.filterViewState = this.loadFilterViewState();
		this.initialColumnState = null;
		this.filterViewBar = null;
		this.filterViewTabsEl = null;
		this.renderFilterViewControls(container);

		const columns: ColumnDef[] = [
			{
				field: '#',
				headerName: '',
				headerTooltip: 'Index',
				editable: false  // 序号列只读
			},
			...this.schema.columnNames.map(name => {
				const baseColDef: ColumnDef = {
					field: name,
					headerName: name,
					editable: true
				};
				const normalizedName = name.trim().toLowerCase();
				if (normalizedName === 'status') {
					baseColDef.headerName = '';
					baseColDef.headerTooltip = 'Status';
				}

				// 应用头部配置对每列的定制
				if (this.schema?.columnConfigs) {
					const config = this.schema.columnConfigs.find(c => c.name === name);
					if (config) {
						this.applyWidthConfig(baseColDef, config);
					}
				}

				
				const storedWidth = this.getStoredColumnWidth(name);
				if (typeof storedWidth === "number" && name !== "#" && name !== "status") {
					const clamped = clampColumnWidth(storedWidth);
					(baseColDef as any).width = clamped;
					(baseColDef as any).__tlbStoredWidth = clamped;
					(baseColDef as any).suppressSizeToFit = true;
				}return baseColDef;
			})
		]

		// 根据 Obsidian 主题选择 AG Grid 主题（支持新窗口）
		const isDarkMode = ownerDoc.body.classList.contains('theme-dark');
		const themeClass = isDarkMode ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

		// 创建表格容器
		const tableContainer = container.createDiv({ cls: `tlb-table-container ${themeClass}` });

		// 销毁旧的表格实例（如果存在）

		const containerWindow = ownerDoc?.defaultView ?? window;
		debugLog('TableView.render container window', this.describeWindow(containerWindow));

		const mountGrid = () => {
			// 销毁旧的表格实例（如果存在）
			if (this.gridAdapter) {
				this.gridAdapter.destroy();
			}

			// 创建并挂载新的表格
			this.gridAdapter = new AgGridAdapter();
			this.gridAdapter.mount(tableContainer, columns, data, {
				onStatusChange: (rowId: string, newStatus: TaskStatus) => {
					this.onStatusChange(rowId, newStatus);
				},
				onColumnResize: (field: string, width: number) => {
					this.handleColumnResize(field, width);
				},
				onCopyH2Section: (rowIndex: number) => {
					this.copyH2Section(rowIndex);
				}
			});
			this.tableContainer = tableContainer;
			this.updateTableContainerSize();

			// 监听单元格编辑事件
			this.gridAdapter.onCellEdit((event) => {
				this.onCellEdit(event);
			});

			// 监听表头编辑事件（暂未实现）
			this.gridAdapter.onHeaderEdit((event) => {
				// TODO: 实现表头编辑
			});

			// 监听最后一行 Enter 事件（自动新增行）
			this.gridAdapter.onEnterAtLastRow?.((field) => {
				const oldRowCount = this.blocks.length;
				this.addRow(oldRowCount);

				// 多次尝试聚焦和编辑，确保成功
				const tryEdit = (attempt: number = 0) => {
					if (!this.gridAdapter || attempt > 5) return;

					const api = (this.gridAdapter as any).gridApi;
					if (!api) return;

					api.ensureIndexVisible(oldRowCount);
					const newRowNode = api.getDisplayedRowAtIndex(oldRowCount);
					newRowNode?.setSelected(true, true);
					api.setFocusedCell(oldRowCount, field);

					api.startEditingCell({
						rowIndex: oldRowCount,
						colKey: field
					});

					setTimeout(() => {
						const editingCells = api.getEditingCells();
						if (editingCells.length === 0) {
							tryEdit(attempt + 1);
						}
					}, 50);
				};

				setTimeout(() => tryEdit(), 50);
			});

			this.applyActiveFilterView();

			// 添加右键菜单监听
			this.setupContextMenu(tableContainer);

			// 添加键盘快捷键
			this.setupKeyboardShortcuts(tableContainer);

			// 设置容器尺寸监听（处理新窗口和窗口调整大小）
			this.setupResizeObserver(tableContainer);

			// 多次尝试调整列宽，确保在新窗口中也能正确初始化
			setTimeout(() => {
				this.gridAdapter?.resizeColumns?.();
			}, 100);

			setTimeout(() => {
				this.gridAdapter?.resizeColumns?.();
			}, 300);

			setTimeout(() => {
				this.gridAdapter?.resizeColumns?.();
			}, 800);
		};

		if (containerWindow && typeof containerWindow.requestAnimationFrame === 'function') {
			containerWindow.requestAnimationFrame(() => {
				mountGrid();
			});
		} else {
			mountGrid();
		}
	}

	/**
	 * 清理事件监听器（防止内存泄漏）
	 */
	private cleanupEventListeners(): void {
		// 移除右键菜单监听器
		if (this.tableContainer && this.contextMenuHandler) {
			this.tableContainer.removeEventListener('contextmenu', this.contextMenuHandler);
			this.contextMenuHandler = null;
		}

		// 移除 document 点击监听器
		if (this.tableContainer && this.documentClickHandler) {
			const ownerDoc = this.tableContainer.ownerDocument;
			ownerDoc.removeEventListener('click', this.documentClickHandler);
			this.documentClickHandler = null;
		}

		// 移除键盘监听器
		if (this.tableContainer && this.keydownHandler) {
			this.tableContainer.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = null;
		}

		if (this.pendingSizeUpdateHandle !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.pendingSizeUpdateHandle);
		}
		this.pendingSizeUpdateHandle = null;

		// 移除 ResizeObserver
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}

		// 移除窗口 resize 监听器
		if (this.tableContainer && this.windowResizeHandler) {
			const ownerWindow = this.tableContainer.ownerDocument.defaultView;
			if (ownerWindow) {
				ownerWindow.removeEventListener('resize', this.windowResizeHandler);
			}
			this.windowResizeHandler = null;
		}

		// 移除 visualViewport 监听
		if (this.visualViewportTarget && this.visualViewportResizeHandler) {
			this.visualViewportTarget.removeEventListener('resize', this.visualViewportResizeHandler);
		}
		this.visualViewportTarget = null;
		this.visualViewportResizeHandler = null;

		// 解除 workspace resize 监听
		if (this.workspaceResizeRef) {
			this.app.workspace.offref(this.workspaceResizeRef);
			this.workspaceResizeRef = null;
		}

		// 停止尺寸轮询
		if (this.sizeCheckInterval) {
			clearInterval(this.sizeCheckInterval);
			this.sizeCheckInterval = null;
		}
		this.lastContainerWidth = 0;
		this.lastContainerHeight = 0;
	}

	/**
	 * 设置容器尺寸监听器（包括窗口 resize）
	 */
	private setupResizeObserver(tableContainer: HTMLElement): void {
		// 清理旧的 observer
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}

		// 清理旧的窗口/viewport/workspace 监听
		if (this.windowResizeHandler) {
			const previousWindow = this.tableContainer?.ownerDocument.defaultView;
			if (previousWindow) {
				previousWindow.removeEventListener('resize', this.windowResizeHandler);
			}
		}
		this.windowResizeHandler = null;

		if (this.visualViewportTarget && this.visualViewportResizeHandler) {
			this.visualViewportTarget.removeEventListener('resize', this.visualViewportResizeHandler);
		}
		this.visualViewportTarget = null;
		this.visualViewportResizeHandler = null;

		if (this.workspaceResizeRef) {
			this.app.workspace.offref(this.workspaceResizeRef);
			this.workspaceResizeRef = null;
		}

		if (this.sizeCheckInterval) {
			clearInterval(this.sizeCheckInterval);
			this.sizeCheckInterval = null;
		}

		// 创建新的 ResizeObserver（监听容器尺寸变化）
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === tableContainer) {
					this.updateTableContainerSize();
					this.scheduleColumnResize('ResizeObserver');
				}
			}
		});

		// 开始监听容器
		this.resizeObserver.observe(tableContainer);

		// 创建窗口 resize 监听器（监听窗口尺寸变化）
		this.windowResizeHandler = () => {
			this.updateTableContainerSize();
			this.scheduleColumnResize('window resize');
		};

		// 获取容器所在的窗口（支持新窗口）
		const ownerWindow = tableContainer.ownerDocument.defaultView;
		if (ownerWindow) {
			ownerWindow.addEventListener('resize', this.windowResizeHandler);

			if ('visualViewport' in ownerWindow && ownerWindow.visualViewport) {
				this.visualViewportTarget = ownerWindow.visualViewport;
				this.visualViewportResizeHandler = () => {
					this.updateTableContainerSize();
					this.scheduleColumnResize('visualViewport resize');
				};
				this.visualViewportTarget.addEventListener('resize', this.visualViewportResizeHandler);
			}
		} else {
			console.error('❌ 无法获取窗口对象！');
		}

		// 监听 Obsidian workspace resize（覆盖跨窗口场景）
		this.workspaceResizeRef = this.app.workspace.on('resize', () => {
			this.updateTableContainerSize();
			this.scheduleColumnResize('workspace resize');
		});

		// 启动尺寸轮询兜底（处理最大化未触发 resize 的情况）
		this.startSizePolling(tableContainer);
	}

	/**
	 * 调度列宽调整（带防抖和延迟重试）
	 */
	private scheduleColumnResize(source: string): void {
		// 使用防抖，避免频繁调用
		if (this.resizeTimeout) {
			clearTimeout(this.resizeTimeout);
		}

		this.resizeTimeout = setTimeout(() => {
			this.gridAdapter?.markLayoutDirty?.();
			this.gridAdapter?.resizeColumns?.();

			// 对于窗口/viewport/workspace 等事件，延迟再次尝试，确保布局稳定
			if (
				source === 'window resize' ||
				source === 'visualViewport resize' ||
				source === 'workspace resize'
			) {
				setTimeout(() => {
					this.gridAdapter?.resizeColumns?.();
				}, 200);

				setTimeout(() => {
					this.gridAdapter?.resizeColumns?.();
				}, 500);
			}

			this.resizeTimeout = null;
		}, 150);
	}

	/**
	 * 启动尺寸轮询（兜底最大化/特殊窗口场景）
	 */
	private startSizePolling(tableContainer: HTMLElement): void {
		if (this.sizeCheckInterval) {
			clearInterval(this.sizeCheckInterval);
		}

		this.lastContainerWidth = tableContainer.offsetWidth;
		this.lastContainerHeight = tableContainer.offsetHeight;

		this.sizeCheckInterval = setInterval(() => {
			if (!tableContainer.isConnected) {
				return;
			}

			const currentWidth = tableContainer.offsetWidth;
			const currentHeight = tableContainer.offsetHeight;

			if (currentWidth !== this.lastContainerWidth || currentHeight !== this.lastContainerHeight) {
				this.lastContainerWidth = currentWidth;
				this.lastContainerHeight = currentHeight;
				this.updateTableContainerSize();
				this.scheduleColumnResize('size polling');
			}
		}, 400);
	}

	private updateTableContainerSize(): void {
		if (!this.tableContainer) return;

		if (this.pendingSizeUpdateHandle !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.pendingSizeUpdateHandle);
			this.pendingSizeUpdateHandle = null;
		}

		const container = this.tableContainer;
		const parent = container.parentElement as HTMLElement | null;

		// 始终允许宽度随父容器自适应
		container.style.removeProperty('width');
		container.style.maxWidth = '100%';
		container.style.width = '100%';

		let targetHeight = 0;
		if (parent) {
			const rect = parent.getBoundingClientRect();
			targetHeight = rect.height || parent.clientHeight || parent.offsetHeight;
		}

		if (targetHeight > 0) {
			const heightPx = `${targetHeight}px`;
			if (container.style.height !== heightPx) {
				container.style.height = heightPx;
			}
		} else {
			container.style.removeProperty('height');
			container.style.height = '100%';
		}
	}

	/**
	 * 设置右键菜单
	 */
	private setupContextMenu(tableContainer: HTMLElement): void {
		// 清理旧的事件监听器
		this.cleanupEventListeners();

		// 保存容器引用
		this.tableContainer = tableContainer;

		// 创建并保存右键菜单处理器
		this.contextMenuHandler = (event: MouseEvent) => {
			// 检查是否点击的是 status 列
			const target = event.target as HTMLElement;
			const cellElement = target.closest('.ag-cell');
			const colId = cellElement?.getAttribute('col-id');

			// 如果是 status 列，让 AG Grid 的原生菜单处理
			if (colId === 'status') {
				return;  // 不阻止事件，让 AG Grid 的 getContextMenuItems 生效
			}

			// 其他列使用自定义菜单
			event.preventDefault();

			// 获取点击行对应的块索引
			const blockIndex = this.gridAdapter?.getRowIndexFromEvent(event);
			if (blockIndex === null || blockIndex === undefined) return;

			// 检查当前选中的行
			const selectedRows = this.gridAdapter?.getSelectedRows() || [];

			// 如果右键点击的行不在已选中的行中，则只选中这一行
			if (!selectedRows.includes(blockIndex)) {
				this.gridAdapter?.selectRow?.(blockIndex, { ensureVisible: true });
			}

			// 显示自定义菜单，传递列ID信息
			this.showContextMenu(event, blockIndex, colId || undefined);
		};

		// 创建并保存点击处理器（点击其他地方隐藏菜单）
		this.documentClickHandler = () => {
			this.hideContextMenu();
		};

		// 绑定事件监听器
		tableContainer.addEventListener('contextmenu', this.contextMenuHandler);

		// 使用容器所在的 document（支持新窗口）
		const ownerDoc = tableContainer.ownerDocument;
		ownerDoc.addEventListener('click', this.documentClickHandler);
	}

	/**
	 * 设置键盘快捷键
	 */
	private setupKeyboardShortcuts(tableContainer: HTMLElement): void {
		// 创建并保存键盘事件处理器
		this.keydownHandler = (event: KeyboardEvent) => {
			// 使用容器所在的 document（支持新窗口）
			const ownerDoc = tableContainer.ownerDocument;
			const activeElement = ownerDoc.activeElement;
			const isEditing = activeElement?.classList.contains('ag-cell-edit-input');

			// 如果正在编辑单元格，不触发其他快捷键
			if (isEditing) {
				return;
			}

			const selectedRows = this.gridAdapter?.getSelectedRows() || [];
			const hasSelection = selectedRows.length > 0;

			// Ctrl+C / Cmd+C: 如果在序号列上，复制整段
			if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
				// 检查当前聚焦的单元格是否是序号列
				const focusedCell = this.gridAdapter?.getFocusedCell?.();
				if (focusedCell?.field === '#' && hasSelection) {
					event.preventDefault();
					// 只复制第一个选中行的整段内容
					this.copyH2Section(selectedRows[0]);
					return;
				}
				// 否则让默认的复制行为继续（AG Grid 会处理单元格内容复制）
			}

			// Cmd+D / Ctrl+D: 复制行（支持单行和多行）
			if ((event.metaKey || event.ctrlKey) && event.key === 'd') {
				event.preventDefault();
				if (hasSelection) {
					if (selectedRows.length > 1) {
						// 多行选择：批量复制
						this.duplicateRows(selectedRows);
					} else {
						// 单行选择：单行复制
						this.duplicateRow(selectedRows[0]);
					}
				}
				return;
			}

			// Delete / Backspace 快捷键禁用：保留原生删除行为，通过上下文菜单删除整行
		};

		// 绑定事件监听器
		tableContainer.addEventListener('keydown', this.keydownHandler);
	}

	/**
	 * 复制 H2 段落到剪贴板
	 */
	private async copyH2Section(blockIndex: number): Promise<void> {
		if (blockIndex < 0 || blockIndex >= this.blocks.length) {
			return;
		}

		const block = this.blocks[blockIndex];
		const markdown = this.blockToMarkdown(block);

		try {
			await navigator.clipboard.writeText(markdown);
			new Notice('已复制整段内容');
		} catch (error) {
			console.error('复制失败:', error);
			new Notice('复制失败');
		}
	}

	/**
	 * 显示右键菜单
	 */
	private showContextMenu(event: MouseEvent, blockIndex: number, colId?: string): void {
		// 移除旧菜单
		this.hideContextMenu();

		// 检查是否在序号列上
		const isIndexColumn = colId === '#';

		// 获取当前选中的所有行
		const selectedRows = this.gridAdapter?.getSelectedRows() || [];
		const isMultiSelect = selectedRows.length > 1;

		// 使用容器所在的 document（支持新窗口）
		const ownerDoc = this.tableContainer?.ownerDocument || document;
		this.contextMenu = ownerDoc.body.createDiv({ cls: 'tlb-context-menu' });
		this.contextMenu.style.visibility = 'hidden';
		this.contextMenu.style.left = '0px';
		this.contextMenu.style.top = '0px';

		// 如果在序号列上，显示"复制整段"菜单
		if (isIndexColumn) {
			const copySection = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
			copySection.createSpan({ text: '复制整段' });
			copySection.addEventListener('click', () => {
				this.copyH2Section(blockIndex);
				this.hideContextMenu();
			});

			// 分隔线
			this.contextMenu.createDiv({ cls: 'tlb-context-menu-separator' });
		}

		// 在上方插入行
		const insertAbove = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
		insertAbove.createSpan({ text: '在上方插入行' });
		insertAbove.addEventListener('click', () => {
			this.addRow(blockIndex);  // 在当前行之前插入
			this.hideContextMenu();
		});

		// 在下方插入行
		const insertBelow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
		insertBelow.createSpan({ text: '在下方插入行' });
		insertBelow.addEventListener('click', () => {
			this.addRow(blockIndex + 1);  // 在当前行之后插入
			this.hideContextMenu();
		});

		// 分隔线
		this.contextMenu.createDiv({ cls: 'tlb-context-menu-separator' });

		if (isMultiSelect) {
			// 多选模式：显示批量操作菜单
			// 复制选中的行
			const duplicateRows = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
			duplicateRows.createSpan({ text: `复制选中的 ${selectedRows.length} 行` });
			duplicateRows.addEventListener('click', () => {
				this.duplicateRows(selectedRows);
				this.hideContextMenu();
			});

			// 删除选中的行
			const deleteRows = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item tlb-context-menu-item-danger' });
			deleteRows.createSpan({ text: `删除选中的 ${selectedRows.length} 行` });
			deleteRows.addEventListener('click', () => {
				this.deleteRows(selectedRows);
				this.hideContextMenu();
			});
		} else {
			// 单选模式：显示单行操作菜单
			// 复制此行
			const duplicateRow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item' });
			duplicateRow.createSpan({ text: '复制此行' });
			duplicateRow.addEventListener('click', () => {
				this.duplicateRow(blockIndex);
				this.hideContextMenu();
			});

			// 删除此行
			const deleteRow = this.contextMenu.createDiv({ cls: 'tlb-context-menu-item tlb-context-menu-item-danger' });
			deleteRow.createSpan({ text: '删除此行' });
			deleteRow.addEventListener('click', () => {
				this.deleteRow(blockIndex);
				this.hideContextMenu();
			});
		}

		// 定位菜单，避免超出屏幕
		const defaultView = ownerDoc.defaultView || window;
		const docElement = ownerDoc.documentElement;
		const viewportWidth = defaultView.innerWidth ?? docElement?.clientWidth ?? 0;
		const viewportHeight = defaultView.innerHeight ?? docElement?.clientHeight ?? 0;
		const menuRect = this.contextMenu.getBoundingClientRect();
		const margin = 8;

		let left = event.clientX;
		let top = event.clientY;

		if (left + menuRect.width > viewportWidth - margin) {
			left = Math.max(margin, viewportWidth - menuRect.width - margin);
		}

		if (top + menuRect.height > viewportHeight - margin) {
			top = Math.max(margin, viewportHeight - menuRect.height - margin);
		}

		if (left < margin) {
			left = margin;
		}

		if (top < margin) {
			top = margin;
		}

		this.contextMenu.style.left = `${left}px`;
		this.contextMenu.style.top = `${top}px`;
		this.contextMenu.style.visibility = 'visible';
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
	 * 处理状态变更
	 * @param rowId 行的稳定 ID（使用 ROW_ID_FIELD）
	 * @param newStatus 新的状态值
	 */
	private onStatusChange(rowId: string, newStatus: TaskStatus): void {
		if (!this.schema || !this.gridAdapter) {
			console.error('Schema or GridAdapter not initialized');
			return;
		}

		// 通过 rowId 获取 blockIndex
		const blockIndex = parseInt(rowId, 10);
		if (isNaN(blockIndex) || blockIndex < 0 || blockIndex >= this.blocks.length) {
			console.error('Invalid blockIndex:', blockIndex);
			return;
		}

		const block = this.blocks[blockIndex];

		// 直接修改 blocks 数组（数据的唯一真实来源）
		block.data['status'] = newStatus;
		block.data['statusChanged'] = getCurrentLocalDateTime();

		// 使用增量刷新（通过 AG Grid API 直接更新单元格）
		const gridApi = (this.gridAdapter as any).gridApi;
		if (gridApi) {
			const rowNode = gridApi.getRowNode(rowId);
			if (rowNode) {
				// 更新 status 单元格
				rowNode.setDataValue('status', newStatus);

				// 触发行样式刷新（done/canceled 状态需要半透明）
				gridApi.redrawRows({ rowNodes: [rowNode] });
			}
		}

		// 触发保存到文件
		this.scheduleSave();
	}

	/**
	 * 处理单元格编辑（Key:Value 格式）
	 */
	private onCellEdit(event: CellEditEvent): void {
		const { rowData, field, newValue, rowIndex } = event;

		// 序号列不可编辑，直接返回
		if (field === '#') {
			return;
		}

		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		const blockIndex = this.getBlockIndexFromRowData(rowData);
		if (blockIndex === null) {
			console.error('无法解析行对应的块索引', { rowData });
			return;
		}

		// blockIndex 直接对应 blocks[blockIndex]（没有模板H2）
		if (blockIndex < 0 || blockIndex >= this.blocks.length) {
			console.error('Invalid block index:', blockIndex);
			return;
		}

		const block = this.blocks[blockIndex];

		// 所有列都更新 data[key]
		block.data[field] = newValue;

		// 触发保存
		this.scheduleSave();
	}

	private getBlockIndexFromRowData(rowData: RowData | undefined): number | null {
		if (!rowData) return null;

		const direct = rowData[ROW_ID_FIELD];
		if (direct !== undefined) {
			const parsed = parseInt(String(direct), 10);
			if (!Number.isNaN(parsed)) {
				return parsed;
			}
		}

		const fallback = rowData['#'];
		if (fallback !== undefined) {
			const parsedFallback = parseInt(String(fallback), 10) - 1;
			if (!Number.isNaN(parsedFallback)) {
				return parsedFallback;
			}
		}

		return null;
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

		const focusedCell = this.gridAdapter?.getFocusedCell?.();
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

			// status 列初始化为 'todo'
			if (key === 'status') {
				newBlock.data[key] = 'todo';
			}
			// 第一列使用"新条目 X"，其他列为空
			else if (i === 0) {
				newBlock.data[key] = `新条目 ${entryNumber}`;
			}
			// 其他列为空
			else {
				newBlock.data[key] = '';
			}
		}

		// 初始化 statusChanged 时间戳
		newBlock.data['statusChanged'] = getCurrentLocalDateTime();

		if (beforeRowIndex !== undefined && beforeRowIndex !== null) {
			// 在指定行之前插入（rowIndex 直接对应 blocks 索引）
			this.blocks.splice(beforeRowIndex, 0, newBlock);
		} else {
			// 在末尾插入
			this.blocks.push(newBlock);
		}

		// 更新 AG Grid 显示
		const data = this.extractTableData(this.blocks, this.schema);
		this.gridAdapter?.updateData(data);

		const insertIndex = (beforeRowIndex !== undefined && beforeRowIndex !== null)
			? beforeRowIndex
			: this.blocks.length - 1;
		this.focusRow(insertIndex, focusedCell?.field);

		// 触发保存
		this.scheduleSave();
	}

	/**
	 * 聚焦并选中指定行，保持视图位置
	 */
	private focusRow(rowIndex: number, field?: string): void {
		if (!this.gridAdapter || !this.schema) {
			return;
		}

		if (rowIndex < 0 || rowIndex >= this.blocks.length) {
			return;
		}

		const fallbackField = this.schema.columnNames[0] ?? null;
		const targetField = (field && field !== ROW_ID_FIELD) ? field : fallbackField;

		setTimeout(() => {
			if (!this.gridAdapter) return;
			this.gridAdapter.selectRow?.(rowIndex, { ensureVisible: true });

			if (!targetField) return;

			const api = (this.gridAdapter as any).gridApi;
			api?.setFocusedCell(rowIndex, targetField);
		}, 0);
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

		const focusedCell = this.gridAdapter?.getFocusedCell?.();

		// 删除块
		this.blocks.splice(rowIndex, 1);

		// 更新 AG Grid 显示
		const data = this.extractTableData(this.blocks, this.schema);
		this.gridAdapter?.updateData(data);

		const nextIndex = Math.min(rowIndex, this.blocks.length - 1);
		if (nextIndex >= 0) {
			this.focusRow(nextIndex, focusedCell?.field);
		}

		// 触发保存
		this.scheduleSave();
	}

	/**
	 * 批量删除指定的多行
	 * @param rowIndexes 要删除的行索引数组（块索引）
	 */
	private deleteRows(rowIndexes: number[]): void {
		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		if (rowIndexes.length === 0) {
			return;
		}

		// 排序索引（从大到小），避免删除时索引偏移
		const sortedIndexes = [...rowIndexes].sort((a, b) => b - a);

		// 删除所有选中的行
		for (const index of sortedIndexes) {
			if (index >= 0 && index < this.blocks.length) {
				this.blocks.splice(index, 1);
			}
		}

		// 更新 AG Grid 显示
		const data = this.extractTableData(this.blocks, this.schema);
		this.gridAdapter?.updateData(data);

		// 聚焦到最小索引位置的下一行
		const minIndex = Math.min(...rowIndexes);
		const nextIndex = Math.min(minIndex, this.blocks.length - 1);
		if (nextIndex >= 0) {
			this.focusRow(nextIndex);
		}

		// 触发保存
		this.scheduleSave();
	}

	/**
	 * 批量复制指定的多行
	 * @param rowIndexes 要复制的行索引数组（块索引）
	 */
	private duplicateRows(rowIndexes: number[]): void {
		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		if (rowIndexes.length === 0) {
			return;
		}

		const focusedCell = this.gridAdapter?.getFocusedCell?.();

		// 排序索引（从大到小），避免插入时索引偏移
		const sortedIndexes = [...rowIndexes].sort((a, b) => b - a);

		// 复制所有选中的行（从高索引到低索引，保持插入位置正确）
		for (const index of sortedIndexes) {
			if (index >= 0 && index < this.blocks.length) {
				const sourceBlock = this.blocks[index];
				const duplicatedBlock: H2Block = {
					title: sourceBlock.title,
					data: { ...sourceBlock.data }
				};

				// 在源块之后插入复制的块
				this.blocks.splice(index + 1, 0, duplicatedBlock);
			}
		}

		// 更新 AG Grid 显示
		const data = this.extractTableData(this.blocks, this.schema);
		this.gridAdapter?.updateData(data);

		// 聚焦到最小索引对应的复制行（最小索引 + 1）
		const minIndex = Math.min(...rowIndexes);
		const newIndex = minIndex + 1;
		this.focusRow(newIndex, focusedCell?.field);

		// 触发保存
		this.scheduleSave();
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

		const focusedCell = this.gridAdapter?.getFocusedCell?.();

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

		const newIndex = rowIndex + 1;
		this.focusRow(newIndex, focusedCell?.field);

		// 触发保存
		this.scheduleSave();
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

	private describeWindow(win: Window | null | undefined): Record<string, unknown> | null {
		if (!win) {
			return null;
		}

		let href: string | undefined;
		try {
			href = win.location?.href;
		} catch (error) {
			href = undefined;
		}

		return {
			href,
			isMain: win === window
		};
	}

	private renderFilterViewControls(container: Element): void {
		const bar = container.createDiv({ cls: 'tlb-filter-view-bar' });
		const tabs = bar.createDiv({ cls: 'tlb-filter-view-tabs' });
		this.filterViewBar = bar;
		this.filterViewTabsEl = tabs;
		this.rebuildFilterViewButtons();

		const actions = bar.createDiv({ cls: 'tlb-filter-view-actions' });
		const addButton = actions.createEl('button', { cls: 'tlb-filter-view-button tlb-filter-view-button--add', text: '+' });
		addButton.addEventListener('click', () => {
			void this.promptCreateFilterView();
		});
	}

	private loadFilterViewState(): FileFilterViewState {
		const plugin = getPluginContext();
		if (!plugin || !this.file || typeof plugin.getFilterViewsForFile !== 'function') {
			return { views: [], activeViewId: null };
		}
		const stored = plugin.getFilterViewsForFile(this.file.path);
		const availableIds = new Set(stored.views.map((view) => view.id));
		const activeId = stored.activeViewId && availableIds.has(stored.activeViewId)
			? stored.activeViewId
			: null;
		return {
			activeViewId: activeId,
			views: stored.views.map((view) => ({
				id: view.id,
				name: view.name,
				filterRule: view.filterRule ?? null,
				columnState: view.columnState ? this.cloneColumnState(view.columnState as ColumnState[]) : null,
				quickFilter: view.quickFilter ?? null
			}))
		};
	}

	private rebuildFilterViewButtons(): void {
		if (!this.filterViewTabsEl) {
			return;
		}
		this.clearElement(this.filterViewTabsEl);

		const defaultButton = this.filterViewTabsEl.createEl('button', { cls: 'tlb-filter-view-button', text: '全部' });
		defaultButton.addEventListener('click', () => {
			this.activateFilterView(null);
		});
		if (!this.filterViewState.activeViewId) {
			defaultButton.classList.add('is-active');
		}

		for (const view of this.filterViewState.views) {
			const button = this.filterViewTabsEl.createEl('button', { cls: 'tlb-filter-view-button', text: view.name });
			if (view.id === this.filterViewState.activeViewId) {
				button.classList.add('is-active');
			}
			button.addEventListener('click', () => {
				this.activateFilterView(view.id);
			});
			button.addEventListener('contextmenu', (event) => {
				this.openFilterViewMenu(event, view);
			});
		}
	}

	private activateFilterView(viewId: string | null): void {
		this.filterViewState.activeViewId = viewId;
		this.rebuildFilterViewButtons();
		void this.persistFilterViews();
		this.applyActiveFilterView();
	}

	private applyActiveFilterView(): void {
		if (!this.gridAdapter) {
			return;
		}
		const targetId = this.filterViewState.activeViewId;
		const targetView = targetId ? this.filterViewState.views.find((view) => view.id === targetId) ?? null : null;

		// 应用过滤规则
		this.gridAdapter.runWhenReady?.(() => {
			if (!this.gridAdapter) {
				return;
			}

			let dataToShow: any[];
			if (!targetView || !targetView.filterRule) {
				// 没有激活视图,显示全部数据
				dataToShow = this.allRowData;
			} else {
				// 应用过滤规则
				dataToShow = this.applyFilterRule(this.allRowData, targetView.filterRule);
			}

			// 使用 AG Grid API 更新数据
			const api = (this.gridAdapter as any).gridApi;
			if (api && typeof api.setGridOption === 'function') {
				api.setGridOption('rowData', dataToShow);
			}
		});
	}

	private applyFilterRule(rows: any[], rule: FilterRule): any[] {
		return rows.filter((row) => {
			const results = rule.conditions.map((condition) => this.evaluateCondition(row, condition));

			if (rule.combineMode === 'AND') {
				return results.every((r) => r);
			} else {
				return results.some((r) => r);
			}
		});
	}

	private evaluateCondition(row: any, condition: FilterCondition): boolean {
		const cellValue = row[condition.column];
		const cellStr = cellValue == null ? '' : String(cellValue).toLowerCase();
		const compareStr = (condition.value ?? '').toLowerCase();

		switch (condition.operator) {
			case 'equals':
				return cellStr === compareStr;
			case 'notEquals':
				return cellStr !== compareStr;
			case 'contains':
				return cellStr.includes(compareStr);
			case 'notContains':
				return !cellStr.includes(compareStr);
			case 'startsWith':
				return cellStr.startsWith(compareStr);
			case 'endsWith':
				return cellStr.endsWith(compareStr);
			case 'isEmpty':
				return cellStr === '';
			case 'isNotEmpty':
				return cellStr !== '';
			case 'greaterThan':
				return parseFloat(cellStr) > parseFloat(compareStr);
			case 'lessThan':
				return parseFloat(cellStr) < parseFloat(compareStr);
			case 'greaterOrEqual':
				return parseFloat(cellStr) >= parseFloat(compareStr);
			case 'lessOrEqual':
				return parseFloat(cellStr) <= parseFloat(compareStr);
			default:
				return false;
		}
	}

	private async promptCreateFilterView(): Promise<void> {
		if (!this.gridAdapter) {
			return;
		}

		// 获取可用的列名
		const columns = this.getAvailableColumns();
		if (columns.length === 0) {
			new Notice('无法获取列信息，请稍后重试');
			return;
		}

		return new Promise((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: '新建过滤视图',
				columns,
				onSubmit: (name, rule) => {
					this.saveFilterView(name, rule);
					resolve();
				},
				onCancel: () => resolve()
			});
			modal.open();
		});
	}

	private saveFilterView(name: string, rule: FilterRule): void {
		const newView: FilterViewDefinition = {
			id: this.generateFilterViewId(),
			name,
			filterRule: rule,
			columnState: null,
			quickFilter: null
		};
		this.filterViewState.views.push(newView);
		this.filterViewState.activeViewId = newView.id;
		this.rebuildFilterViewButtons();
		void this.persistFilterViews();
		this.applyActiveFilterView();
	}

	private getAvailableColumns(): string[] {
		// 优先使用 schema 中的列名
		if (this.schema?.columnNames) {
			return this.schema.columnNames;
		}

		// 备用方案: 从 GridAdapter 获取列状态
		const columnState = this.gridAdapter?.getColumnState?.();
		if (!columnState) {
			return [];
		}

		// 过滤掉内部列(如状态列、索引列)
		return columnState
			.filter((col) => col.colId && !col.colId.startsWith('ag-Grid'))
			.map((col) => col.colId!)
			.filter((colId) => colId !== '__tlb_status' && colId !== '__tlb_index' && colId !== '#' && colId !== 'status');
	}

	private async updateFilterView(viewId: string): Promise<void> {
		const target = this.filterViewState.views.find((view) => view.id === viewId);
		if (!target || !this.gridAdapter) {
			return;
		}

		// 获取可用的列名
		const columns = this.getAvailableColumns();
		if (columns.length === 0) {
			return;
		}

		return new Promise((resolve) => {
			const modal = new FilterViewEditorModal(this.app, {
				title: `编辑视图: ${target.name}`,
				columns,
				initialRule: target.filterRule,
				onSubmit: (name, rule) => {
					target.name = name;
					target.filterRule = rule;
					this.rebuildFilterViewButtons();
					void this.persistFilterViews();
					this.applyActiveFilterView();
					resolve();
				},
				onCancel: () => resolve()
			});
			modal.open();
		});
	}

	private async renameFilterView(viewId: string): Promise<void> {
		const target = this.filterViewState.views.find((view) => view.id === viewId);
		if (!target) {
			return;
		}
		const name = await this.openFilterViewNameModal({
			title: '重命名视图',
			placeholder: '输入新名称',
			defaultValue: target.name
		});
		if (!name || name === target.name) {
			return;
		}
		target.name = name;
		this.rebuildFilterViewButtons();
		void this.persistFilterViews();
	}

	private deleteFilterView(viewId: string): void {
		const index = this.filterViewState.views.findIndex((view) => view.id === viewId);
		if (index === -1) {
			return;
		}
		this.filterViewState.views.splice(index, 1);
		if (this.filterViewState.activeViewId === viewId) {
			this.filterViewState.activeViewId = null;
		}
		this.rebuildFilterViewButtons();
		void this.persistFilterViews();
		this.applyActiveFilterView();
	}

	private openFilterViewMenu(event: MouseEvent, view: FilterViewDefinition): void {
		event.preventDefault();
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle('重命名').onClick(() => {
				this.renameFilterView(view.id);
			});
		});
		menu.addItem((item) => {
			item.setTitle('更新为当前过滤条件').onClick(() => {
				this.updateFilterView(view.id);
			});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle('删除').setIcon('trash').onClick(() => {
				this.deleteFilterView(view.id);
			});
		});
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	private generateFilterViewId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
		return `fv-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
	}

	private persistFilterViews(): Promise<void> | void {
		const plugin = getPluginContext();
		if (!plugin || !this.file || typeof plugin.saveFilterViewsForFile !== 'function') {
			return;
		}
		return plugin.saveFilterViewsForFile(this.file.path, this.filterViewState);
	}

	private cloneColumnState(state: ColumnState[] | null | undefined): ColumnState[] | null {
		if (!state) {
			return null;
		}
		return state.map((item) => ({ ...item }));
	}

	private deepClone<T>(value: T): T {
		if (value == null) {
			return value;
		}
		return JSON.parse(JSON.stringify(value)) as T;
	}

	private clearElement(element: HTMLElement): void {
		while (element.firstChild) {
			element.removeChild(element.firstChild);
		}
	}

	private openFilterViewNameModal(options: { title: string; placeholder: string; defaultValue?: string }): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new FilterViewNameModal(this.app, {
				title: options.title,
				placeholder: options.placeholder,
				defaultValue: options.defaultValue ?? '',
				onSubmit: (value) => {
					const trimmed = value.trim();
					resolve(trimmed.length > 0 ? trimmed : null);
				},
				onCancel: () => resolve(null)
			});
			modal.open();
		});
	}

	async onClose(): Promise<void> {
		// 清理事件监听器
		this.cleanupEventListeners();

		// 隐藏右键菜单
		this.hideContextMenu();

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

		// 清理 resize 定时器
		if (this.resizeTimeout) {
			clearTimeout(this.resizeTimeout);
			this.resizeTimeout = null;
		}

		// 清理容器引用
		this.tableContainer = null;
	}
}

interface FilterViewEditorModalOptions {
	title: string;
	columns: string[];  // 可用的列名列表
	initialRule?: FilterRule | null;  // 初始规则(用于编辑)
	onSubmit: (name: string, rule: FilterRule) => void;
	onCancel: () => void;
}

class FilterViewEditorModal extends Modal {
	private readonly options: FilterViewEditorModalOptions;
	private nameInputEl!: HTMLInputElement;
	private conditionsContainer!: HTMLElement;
	private combineModeSelect!: HTMLSelectElement;
	private conditions: FilterCondition[] = [];
	private combineMode: 'AND' | 'OR' = 'AND';

	constructor(app: App, options: FilterViewEditorModalOptions) {
		super(app);
		this.options = options;
		if (options.initialRule) {
			this.conditions = [...options.initialRule.conditions];
			this.combineMode = options.initialRule.combineMode;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-filter-editor-modal');
		this.titleEl.setText(this.options.title);

		// 视图名称输入
		const nameSetting = new Setting(contentEl);
		nameSetting.setName('视图名称');
		nameSetting.addText((text) => {
			text.setPlaceholder('输入视图名称');
			this.nameInputEl = text.inputEl;
		});

		// 组合模式选择
		const modeSetting = new Setting(contentEl);
		modeSetting.setName('条件组合方式');
		modeSetting.addDropdown((dropdown) => {
			dropdown.addOption('AND', '满足所有条件 (AND)');
			dropdown.addOption('OR', '满足任一条件 (OR)');
			dropdown.setValue(this.combineMode);
			dropdown.onChange((value) => {
				this.combineMode = value as 'AND' | 'OR';
			});
			this.combineModeSelect = dropdown.selectEl;
		});

		// 过滤条件列表
		contentEl.createEl('h3', { text: '过滤条件' });
		this.conditionsContainer = contentEl.createDiv({ cls: 'tlb-filter-conditions' });
		this.renderConditions();

		// 添加条件按钮
		const addButton = contentEl.createEl('button', { text: '+ 添加条件' });
		addButton.addClass('mod-cta');
		addButton.addEventListener('click', () => {
			this.addCondition();
		});

		// 底部按钮
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		const saveButton = buttonContainer.createEl('button', { text: '保存' });
		saveButton.addClass('mod-cta');
		saveButton.addEventListener('click', () => this.submit());

		const cancelButton = buttonContainer.createEl('button', { text: '取消' });
		cancelButton.addEventListener('click', () => this.close());
	}

	private renderConditions(): void {
		this.conditionsContainer.empty();

		if (this.conditions.length === 0) {
			this.conditionsContainer.createEl('p', {
				text: '暂无过滤条件,点击下方"添加条件"按钮开始',
				cls: 'tlb-filter-empty-hint'
			});
			return;
		}

		this.conditions.forEach((condition, index) => {
			const row = this.conditionsContainer.createDiv({ cls: 'tlb-filter-condition-row' });

			// 列选择
			const columnSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			this.options.columns.forEach((col) => {
				const option = columnSelect.createEl('option', { text: col, value: col });
				if (col === condition.column) {
					option.selected = true;
				}
			});
			columnSelect.addEventListener('change', () => {
				condition.column = columnSelect.value;
			});

			// 运算符选择
			const operatorSelect = row.createEl('select', { cls: 'tlb-filter-select' });
			const operators: { value: FilterOperator; label: string }[] = [
				{ value: 'equals', label: '等于' },
				{ value: 'notEquals', label: '不等于' },
				{ value: 'contains', label: '包含' },
				{ value: 'notContains', label: '不包含' },
				{ value: 'startsWith', label: '开头是' },
				{ value: 'endsWith', label: '结尾是' },
				{ value: 'isEmpty', label: '为空' },
				{ value: 'isNotEmpty', label: '不为空' },
			];
			operators.forEach((op) => {
				const option = operatorSelect.createEl('option', { text: op.label, value: op.value });
				if (op.value === condition.operator) {
					option.selected = true;
				}
			});
			operatorSelect.addEventListener('change', () => {
				condition.operator = operatorSelect.value as FilterOperator;
				this.renderConditions(); // 重新渲染以显示/隐藏值输入框
			});

			// 值输入(某些运算符不需要)
			const needsValue = !['isEmpty', 'isNotEmpty'].includes(condition.operator);
			if (needsValue) {
				const valueInput = row.createEl('input', {
					type: 'text',
					cls: 'tlb-filter-input',
					placeholder: '输入值'
				});
				valueInput.value = condition.value ?? '';
				valueInput.addEventListener('input', () => {
					condition.value = valueInput.value;
				});
			}

			// 删除按钮
			const deleteButton = row.createEl('button', { text: '删除', cls: 'mod-warning' });
			deleteButton.addEventListener('click', () => {
				this.conditions.splice(index, 1);
				this.renderConditions();
			});
		});
	}

	private addCondition(): void {
		const firstColumn = this.options.columns[0] ?? 'status';
		this.conditions.push({
			column: firstColumn,
			operator: 'equals',
			value: ''
		});
		this.renderConditions();
	}

	private submit(): void {
		const name = this.nameInputEl?.value?.trim();
		if (!name) {
			// TODO: 显示错误提示
			return;
		}

		if (this.conditions.length === 0) {
			// TODO: 显示错误提示
			return;
		}

		const rule: FilterRule = {
			conditions: this.conditions,
			combineMode: this.combineMode
		};

		this.options.onSubmit(name, rule);
		this.options.onCancel = () => {}; // 防止重复调用
		this.close();
	}

	onClose(): void {
		this.options.onCancel();
	}
}

interface FilterViewNameModalOptions {
	title: string;
	placeholder: string;
	defaultValue: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

class FilterViewNameModal extends Modal {
	private readonly options: FilterViewNameModalOptions;
	private inputEl!: HTMLInputElement;

	constructor(app: App, options: FilterViewNameModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.options.title);

		const setting = new Setting(contentEl);
		setting.setClass('tlb-filter-view-modal');
		setting.addText((text) => {
			text.setPlaceholder(this.options.placeholder);
			text.setValue(this.options.defaultValue);
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();
					this.submit();
				}
			});
			this.inputEl = text.inputEl;
		});

		setting.addButton((button) => {
			button.setButtonText('保存');
			button.setCta();
			button.onClick(() => this.submit());
		});

		const cancelBtn = contentEl.createEl('button', { text: '取消' });
		cancelBtn.addClass('mod-cta-secondary');
		cancelBtn.addEventListener('click', () => {
			this.close();
		});
	}

	onClose(): void {
		if (this.inputEl) {
			this.inputEl.blur();
		}
		this.options.onCancel();
	}

	private submit(): void {
		const value = this.inputEl?.value ?? '';
		this.options.onSubmit(value);
		this.options.onCancel = () => {};
		this.close();
	}
}

