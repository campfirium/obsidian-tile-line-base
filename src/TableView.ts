import { ItemView, WorkspaceLeaf, TFile, EventRef } from "obsidian";
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
	private contextMenu: HTMLElement | null = null;

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

		console.log('📋 解析头部配置块:', columnConfigs);
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
			console.log(`列 ${config.name} 使用 flex: 1（分配剩余空间）`);
			return;
		}

		// 百分比宽度：使用 flex 按比例分配
		if (width.endsWith('%')) {
			const percentage = parseInt(width.replace('%', ''));
			if (!isNaN(percentage)) {
				(colDef as any).flex = percentage;
				console.log(`列 ${config.name} 使用 flex: ${percentage}`);
			}
			return;
		}

		// 像素宽度：固定宽度
		if (width.endsWith('px')) {
			const pixels = parseInt(width.replace('px', ''));
			if (!isNaN(pixels)) {
				(colDef as any).width = pixels;
				console.log(`列 ${config.name} 使用固定宽度: ${pixels}px`);
			}
			return;
		}

		// 尝试作为数字处理（默认像素）
		const num = parseInt(width);
		if (!isNaN(num)) {
			(colDef as any).width = num;
			console.log(`列 ${config.name} 使用固定宽度: ${num}px`);
		}
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
					if (!seenKeys.has(key)) {
						columnNames.push(key);
						seenKeys.add(key);
					}
				}
			}
		}

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

		// 准备列定义（添加序号列）
		const columns: ColumnDef[] = [
			{
				field: '#',
				headerName: '#',
				editable: false  // 序号列只读
			},
			...this.schema.columnNames.map(name => {
				const baseColDef: ColumnDef = {
					field: name,
					headerName: name,
					editable: true
				};

				// 应用头部配置块中的宽度配置
				if (this.schema?.columnConfigs) {
					const config = this.schema.columnConfigs.find(c => c.name === name);
					if (config) {
						console.log(`🔧 配置列 ${name}:`, config);
						this.applyWidthConfig(baseColDef, config);
						console.log(`🔧 应用后的 colDef:`, baseColDef);
					} else {
						console.log(`⚠️ 列 ${name} 没有找到配置`);
					}
				}

				return baseColDef;
			})
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

		// 设置容器尺寸监听（处理新窗口和窗口调整大小）
		console.log('🚀 === 开始设置 ResizeObserver ===');
		this.setupResizeObserver(tableContainer);
		console.log('🚀 === ResizeObserver 设置完成 ===');

		// 多次尝试调整列宽，确保在新窗口中也能正确初始化
		console.log('🚀 安排初始化列宽调整（100ms, 300ms, 800ms）');

		// 第一次：立即尝试（可能容器尺寸还未确定）
		setTimeout(() => {
			console.log('⏰ 执行第1次初始化列宽调整（100ms）');
			this.gridAdapter?.resizeColumns?.();
		}, 100);

		// 第二次：延迟尝试（容器尺寸应该已确定）
		setTimeout(() => {
			console.log('⏰ 执行第2次初始化列宽调整（300ms）');
			this.gridAdapter?.resizeColumns?.();
		}, 300);

		// 第三次：最后一次尝试（确保在所有布局完成后）
		setTimeout(() => {
			console.log('⏰ 执行第3次初始化列宽调整（800ms）');
			this.gridAdapter?.resizeColumns?.();
		}, 800);

		console.log(`TileLineBase 表格已渲染（AG Grid）：${this.file.path}`);
		console.log(`Schema:`, this.schema);
		console.log(`数据行数: ${data.length}`);
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
		console.log('🔧 setupResizeObserver 开始执行');

		// 清理旧的 observer
		if (this.resizeObserver) {
			console.log('🧹 清理旧的 ResizeObserver');
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
		console.log('🔧 创建 ResizeObserver');
		this.resizeObserver = new ResizeObserver((entries) => {
			console.log('🔔 ResizeObserver 回调被触发，entries 数量:', entries.length);
			for (const entry of entries) {
				if (entry.target === tableContainer) {
					console.log('📐 容器尺寸变化 (ResizeObserver):', {
						width: entry.contentRect.width,
						height: entry.contentRect.height
					});

					this.scheduleColumnResize('ResizeObserver');
				}
			}
		});

		// 开始监听容器
		console.log('🔧 开始监听容器，容器元素:', tableContainer);
		this.resizeObserver.observe(tableContainer);
		console.log('✅ ResizeObserver 已开始监听');

		// 创建窗口 resize 监听器（监听窗口尺寸变化）
		console.log('🔧 创建窗口 resize 监听器');
		this.windowResizeHandler = () => {
			console.log('🔔 窗口 resize 事件被触发！');
			const ownerWindowCurrent = tableContainer.ownerDocument.defaultView;
			if (ownerWindowCurrent) {
				console.log('📐 窗口尺寸变化 (window resize):', {
					innerWidth: ownerWindowCurrent.innerWidth,
					innerHeight: ownerWindowCurrent.innerHeight,
					containerWidth: tableContainer.offsetWidth,
					containerHeight: tableContainer.offsetHeight
				});
			}
			this.scheduleColumnResize('window resize');
		};

		// 获取容器所在的窗口（支持新窗口）
		const ownerWindow = tableContainer.ownerDocument.defaultView;
		console.log('🔧 获取窗口对象:', ownerWindow);
		if (ownerWindow) {
			ownerWindow.addEventListener('resize', this.windowResizeHandler);
			console.log('✅ 已添加窗口 resize 监听器到窗口');
			console.log('📊 当前窗口尺寸:', {
				innerWidth: ownerWindow.innerWidth,
				innerHeight: ownerWindow.innerHeight
			});

			if ('visualViewport' in ownerWindow && ownerWindow.visualViewport) {
				this.visualViewportTarget = ownerWindow.visualViewport;
				this.visualViewportResizeHandler = () => {
					const viewport = ownerWindow.visualViewport;
					console.log('🔔 visualViewport resize 事件被触发！', {
						width: viewport?.width,
						height: viewport?.height,
						scale: viewport?.scale
					});
					this.scheduleColumnResize('visualViewport resize');
				};
				this.visualViewportTarget.addEventListener('resize', this.visualViewportResizeHandler);
				console.log('✅ 已添加 visualViewport resize 监听器');
			} else {
				console.log('⚠️ 当前窗口不支持 visualViewport 监听');
			}
		} else {
			console.error('❌ 无法获取窗口对象！');
		}

		// 监听 Obsidian workspace resize（覆盖跨窗口场景）
		this.workspaceResizeRef = this.app.workspace.on('resize', () => {
			console.log('🔔 workspace.resize 事件被触发！');
			if (tableContainer.isConnected) {
				console.log('📏 workspace.resize -> 容器尺寸:', {
					width: tableContainer.offsetWidth,
					height: tableContainer.offsetHeight
				});
			}
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
			console.log(`🔄 触发列宽调整 (${source})`);
			this.gridAdapter?.resizeColumns?.();

			// 对于窗口/viewport/workspace 等事件，延迟再次尝试，确保布局稳定
			if (
				source === 'window resize' ||
				source === 'visualViewport resize' ||
				source === 'workspace resize'
			) {
				setTimeout(() => {
					console.log(`🔄 延迟重试列宽调整 (${source} + 200ms)`);
					this.gridAdapter?.resizeColumns?.();
				}, 200);

				setTimeout(() => {
					console.log(`🔄 延迟重试列宽调整 (${source} + 500ms)`);
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

		console.log('🔁 开始尺寸轮询:', {
			width: this.lastContainerWidth,
			height: this.lastContainerHeight
		});

		this.sizeCheckInterval = setInterval(() => {
			if (!tableContainer.isConnected) {
				return;
			}

			const currentWidth = tableContainer.offsetWidth;
			const currentHeight = tableContainer.offsetHeight;

			if (currentWidth !== this.lastContainerWidth || currentHeight !== this.lastContainerHeight) {
				console.log('🔁 尺寸轮询检测到变化:', {
					width: currentWidth,
					height: currentHeight,
					previousWidth: this.lastContainerWidth,
					previousHeight: this.lastContainerHeight
				});

				this.lastContainerWidth = currentWidth;
				this.lastContainerHeight = currentHeight;
				this.scheduleColumnResize('size polling');
			}
		}, 400);
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
			event.preventDefault();

			// 获取点击的行索引
			const rowIndex = this.gridAdapter?.getRowIndexFromEvent(event);
			if (rowIndex === null || rowIndex === undefined) return;

			// 显示自定义菜单
			this.showContextMenu(event, rowIndex);
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
			// 如果正在编辑单元格，不触发快捷键
			const activeElement = document.activeElement;
			if (activeElement?.classList.contains('ag-cell-edit-input')) {
				return;
			}

			const selectedRows = this.gridAdapter?.getSelectedRows() || [];
			const hasSelection = selectedRows.length > 0;
			const firstSelectedRow = hasSelection ? selectedRows[0] : null;

			// Enter 快捷键禁用：避免误触自动插入新行

			// Cmd+D / Ctrl+D: 复制行
			if ((event.metaKey || event.ctrlKey) && event.key === 'd') {
				event.preventDefault();
				if (hasSelection && firstSelectedRow !== null) {
					this.duplicateRow(firstSelectedRow);
				}
				return;
			}

			// Delete / Backspace 快捷键禁用：保留原生删除行为，通过上下文菜单删除整行
		};

		// 绑定事件监听器
		tableContainer.addEventListener('keydown', this.keydownHandler);
	}

	/**
	 * 显示右键菜单
	 */
	private showContextMenu(event: MouseEvent, rowIndex: number): void {
		// 移除旧菜单
		this.hideContextMenu();

		// 使用容器所在的 document（支持新窗口）
		const ownerDoc = this.tableContainer?.ownerDocument || document;
		this.contextMenu = ownerDoc.body.createDiv({ cls: 'tlb-context-menu' });

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
