import { App, ItemView, WorkspaceLeaf, TFile, EventRef, Menu, Modal, Setting, Notice, setIcon } from "obsidian";
import { GridAdapter, ColumnDef, RowData, CellEditEvent, ROW_ID_FIELD, SortModelEntry, HeaderEditEvent } from "./grid/GridAdapter";
import { TaskStatus } from "./renderers/StatusCellRenderer";
import { getPluginContext } from "./pluginContext";
import { clampColumnWidth } from "./grid/columnSizing";
import { getCurrentLocalDateTime } from "./utils/datetime";
import { debugLog } from "./utils/logger";
import { compileFormula, evaluateFormula, CompiledFormula } from "./formula/FormulaEngine";
import type { ColumnState } from "ag-grid-community";
import type { FileFilterViewState, FilterRule, FilterCondition, FilterOperator, SortRule } from "./types/filterView";
import { ColumnLayoutStore } from "./table-view/ColumnLayoutStore";
import { GridController } from "./table-view/GridController";
import { MarkdownBlockParser, ColumnConfig, H2Block } from "./table-view/MarkdownBlockParser";
import { SchemaBuilder, Schema } from "./table-view/SchemaBuilder";
import { FilterStateStore } from "./table-view/filter/FilterStateStore";
import { FilterViewBar } from "./table-view/filter/FilterViewBar";
import { FilterViewController } from "./table-view/filter/FilterViewController";
import { FilterDataProcessor } from "./table-view/filter/FilterDataProcessor";
import { globalQuickFilterManager } from "./table-view/filter/GlobalQuickFilterManager";

const LOG_PREFIX = "[TileLineBase]";
const FORMULA_ROW_LIMIT = 5000;
const FORMULA_ERROR_VALUE = '#ERR';
const FORMULA_TOOLTIP_PREFIX = '__tlbFormulaTooltip__';

export const TABLE_VIEW_TYPE = "tile-line-base-table";

interface TableViewState extends Record<string, unknown> {
	filePath: string;
}

interface PendingFocusRequest {
	rowIndex: number;
	field?: string | null;
	maxRetries: number;
	retriesLeft: number;
	retryDelay: number;
	pendingVerification: boolean;
}

export class TableView extends ItemView {
	file: TFile | null = null;
	private blocks: H2Block[] = [];
	private schema: Schema | null = null;
	private schemaDirty: boolean = false;
	private sparseCleanupRequired: boolean = false;
	private saveTimeout: NodeJS.Timeout | null = null;
	private gridAdapter: GridAdapter | null = null;
	private gridController = new GridController();
	private pendingFocusRequest: PendingFocusRequest | null = null;
	private focusRetryTimer: ReturnType<typeof setTimeout> | null = null;
	private allRowData: any[] = []; // 保存全部行数据
	private visibleRowData: RowData[] = [];
	private contextMenu: HTMLElement | null = null;
	private columnLayoutStore = new ColumnLayoutStore(null);
	private markdownParser = new MarkdownBlockParser();
	private schemaBuilder = new SchemaBuilder();
	private fileId: string | null = null; // 文件唯一ID（8位UUID）

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
	private filterViewBar: FilterViewBar | null = null;
	private filterViewController: FilterViewController;
	private filterStateStore = new FilterStateStore(null);
	private filterViewState: FileFilterViewState = this.filterStateStore.getState();
	private initialColumnState: ColumnState[] | null = null;
	private hiddenSortableFields: Set<string> = new Set();
	private globalQuickFilterInputEl: HTMLInputElement | null = null;
	private globalQuickFilterClearEl: HTMLElement | null = null;
	private globalQuickFilterUnsubscribe: (() => void) | null = null;
	private hasRegisteredGlobalQuickFilter = false;
	private formulaColumns: Map<string, CompiledFormula> = new Map();
	private formulaCompileErrors: Map<string, string> = new Map();
	private formulaColumnOrder: string[] = [];
	private formulaLimitNoticeIssued = false;


	constructor(leaf: WorkspaceLeaf) {
		debugLog('=== TableView 构造函数开始 ===');
		debugLog('leaf:', leaf);
		super(leaf);
		this.filterViewController = new FilterViewController({
			app: this.app,
			stateStore: this.filterStateStore,
			getAvailableColumns: () => this.getAvailableColumns(),
			persist: () => this.persistFilterViews(),
			applyActiveFilterView: () => this.applyActiveFilterView(),
			syncState: () => this.syncFilterViewState(),
			renderBar: () => {
				if (this.filterViewBar) {
					this.filterViewBar.render(this.filterViewState);
				}
			}
		});
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

	private getStoredColumnWidth(field: string): number | undefined {
		return this.columnLayoutStore.getWidth(field);
	}

	private handleColumnResize(field: string, width: number): void {
		if (!this.file) {
			return;
		}
		if (field === '#' || field === 'status') {
			return;
		}

		const changed = this.columnLayoutStore.updateWidth(field, width);
		if (!changed) {
			return;
		}

		// 保存到配置块（带缓存）
		this.saveConfigBlock().catch((error) => {
			console.error('[TileLineBase] Failed to save config block:', error);
		});
	}

	private handleColumnOrderChange(orderedFields: string[]): void {
		if (!this.schema) {
			return;
		}

		const currentOrder = this.schema.columnNames;
		if (currentOrder.length === 0) {
			return;
		}

		const primaryField = currentOrder[0] ?? null;
		const fixedFields = new Set<string>();
		if (primaryField) {
			fixedFields.add(primaryField);
		}
		if (currentOrder.includes('status')) {
			fixedFields.add('status');
		}

		const movableFields = currentOrder.filter((field) => !fixedFields.has(field));
		if (movableFields.length === 0) {
			return;
		}

		const normalizedOrder = orderedFields
			.map((field) => (typeof field === 'string' ? field.trim() : ''))
			.filter((field) => field.length > 0 && field !== '#' && field !== ROW_ID_FIELD);

		const reorderedMovable: string[] = [];
		for (const field of normalizedOrder) {
			if (fixedFields.has(field)) {
				continue;
			}
			if (!movableFields.includes(field)) {
				continue;
			}
			if (!reorderedMovable.includes(field)) {
				reorderedMovable.push(field);
			}
		}

		for (const field of movableFields) {
			if (!reorderedMovable.includes(field)) {
				reorderedMovable.push(field);
			}
		}

		const nextOrder: string[] = [];
		const appendUnique = (field: string | null) => {
			if (!field) return;
			if (!nextOrder.includes(field)) {
				nextOrder.push(field);
			}
		};

		appendUnique(primaryField);
		if (fixedFields.has('status')) {
			appendUnique('status');
		}

		for (const field of reorderedMovable) {
			appendUnique(field);
		}

		if (nextOrder.length !== currentOrder.length) {
			return;
		}

		let changed = false;
		for (let i = 0; i < nextOrder.length; i++) {
			if (nextOrder[i] !== currentOrder[i]) {
				changed = true;
				break;
			}
		}

		if (!changed) {
			return;
		}

		this.schema.columnNames.splice(0, this.schema.columnNames.length, ...nextOrder);

		if (this.schema.columnConfigs && this.schema.columnConfigs.length > 0) {
			const configMap = new Map(this.schema.columnConfigs.map((config) => [config.name, config]));
			const orderedConfigs: ColumnConfig[] = [];
			const seen = new Set<string>();

			for (const field of nextOrder) {
				const config = configMap.get(field);
				if (config && !seen.has(config.name)) {
					orderedConfigs.push(config);
					seen.add(config.name);
				}
			}

			for (const config of this.schema.columnConfigs) {
				if (!seen.has(config.name)) {
					orderedConfigs.push(config);
					seen.add(config.name);
				}
			}

			this.schema.columnConfigs = orderedConfigs.length > 0 ? orderedConfigs : undefined;
		}

		this.scheduleSave();
	}


	private deserializeColumnConfigs(raw: unknown): ColumnConfig[] | null {
		if (!Array.isArray(raw)) {
			return null;
		}
		const result: ColumnConfig[] = [];
		for (const entry of raw) {
			if (typeof entry !== 'string' || entry.trim().length === 0) {
				continue;
			}
			const config = this.markdownParser.parseColumnDefinition(entry);
			if (config) {
				result.push(config);
			}
		}
		return result.length > 0 ? result : null;
	}

	private hasColumnConfigContent(config: ColumnConfig): boolean {
		return Boolean(
			(config.width && config.width.trim().length > 0) ||
			(config.unit && config.unit.trim().length > 0) ||
			config.hide ||
			(config.formula && config.formula.trim().length > 0)
		);
	}

	private serializeColumnConfig(config: ColumnConfig): string {
		const segments: string[] = [];
		if (config.width && config.width.trim().length > 0) {
			segments.push(`width: ${config.width.trim()}`);
		}
		if (config.unit && config.unit.trim().length > 0) {
			segments.push(`unit: ${config.unit.trim()}`);
		}
		if (config.formula && config.formula.trim().length > 0) {
			segments.push(`formula: ${config.formula.trim()}`);
		}
		if (config.hide) {
			segments.push('hide');
		}

		const name = config.name.trim();
		if (segments.length === 0) {
			return name;
		}
		return `${name} ${segments.map((segment) => `(${segment})`).join(' ')}`;
	}

	private getFormulaTooltipField(columnName: string): string {
		return `${FORMULA_TOOLTIP_PREFIX}${columnName}`;
	}

	private prepareFormulaColumns(columnConfigs: ColumnConfig[] | null): void {
		this.formulaColumns.clear();
		this.formulaCompileErrors.clear();
		this.formulaColumnOrder = [];
		this.formulaLimitNoticeIssued = false;

		if (!columnConfigs) {
			return;
		}

		for (const config of columnConfigs) {
			const rawFormula = config.formula?.trim();
			if (!rawFormula) {
				continue;
			}
			this.formulaColumnOrder.push(config.name);
			try {
				const compiled = compileFormula(rawFormula);
				if (compiled.dependencies.includes(config.name)) {
					this.formulaCompileErrors.set(config.name, '公式不允许引用自身');
					continue;
				}
				this.formulaColumns.set(config.name, compiled);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.formulaCompileErrors.set(config.name, message);
				debugLog('公式解析失败', { column: config.name, message });
			}
		}
	}

	private applyFormulaResults(row: RowData, rowCount: number): void {
		if (this.formulaColumnOrder.length === 0) {
			return;
		}

		const formulasEnabled = rowCount <= FORMULA_ROW_LIMIT;
		if (!formulasEnabled && !this.formulaLimitNoticeIssued) {
			new Notice(`公式列已停用（行数超过 ${FORMULA_ROW_LIMIT}）`);
			this.formulaLimitNoticeIssued = true;
		}

		for (const columnName of this.formulaColumnOrder) {
			const tooltipField = this.getFormulaTooltipField(columnName);
			const compileError = this.formulaCompileErrors.get(columnName);
			if (compileError) {
				row[columnName] = FORMULA_ERROR_VALUE;
				row[tooltipField] = `公式解析失败：${compileError}`;
				continue;
			}

			if (!formulasEnabled) {
				row[tooltipField] = `公式列已停用（行数超过 ${FORMULA_ROW_LIMIT}）`;
				continue;
			}

			const compiled = this.formulaColumns.get(columnName);
			if (!compiled) {
				continue;
			}

			const { value, error } = evaluateFormula(compiled, row);
			if (error) {
				row[columnName] = FORMULA_ERROR_VALUE;
				row[tooltipField] = `公式错误：${error}`;
				debugLog('公式运行失败', { column: columnName, formula: compiled.original, error });
			} else {
				row[columnName] = value;
				row[tooltipField] = '';
			}
		}
	}

	private handleColumnHeaderContextMenu(field: string, event: MouseEvent): void {
		if (!this.schema) {
			return;
		}
		if (!field || field === '#' || field === ROW_ID_FIELD || field === 'status') {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.openColumnHeaderMenu(field, event);
	}

	private openColumnHeaderMenu(field: string, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle('编辑列').setIcon('pencil').onClick(() => {
				this.openColumnEditModal(field);
			});
		});
		menu.addItem((item) => {
			item.setTitle('复制列').setIcon('copy').onClick(() => {
				this.duplicateColumn(field);
			});
		});
		menu.addItem((item) => {
			item.setTitle('插入列').setIcon('plus').onClick(() => {
				this.insertColumnAfter(field);
			});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle('删除列').setIcon('trash').onClick(() => {
				this.removeColumn(field);
			});
		});
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	private openColumnEditModal(field: string): void {
		if (!this.schema) {
			return;
		}
		const configs = this.schema.columnConfigs ?? [];
		const existing = configs.find((config) => config.name === field);
		const initialType: ColumnFieldType = existing?.formula?.trim() ? 'formula' : 'text';
		const initialFormula = existing?.formula ?? '';
		const validateName = (name: string): string | null => {
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return '列名称不能为空';
			}
			if (trimmed === field) {
				return null;
			}
			if (trimmed === '#' || trimmed === ROW_ID_FIELD || trimmed === 'status') {
				return '该名称已被系统保留';
			}
			if (this.schema?.columnNames?.some((item) => item === trimmed)) {
				return '列名称已存在';
			}
			return null;
		};
		const modal = new ColumnEditorModal(this.app, {
			columnName: field,
			initialType,
			initialFormula,
			validateName,
			onSubmit: (result) => {
				this.applyColumnEditResult(field, result);
			},
			onCancel: () => {}
		});
		modal.open();
	}

	private applyColumnEditResult(field: string, result: ColumnEditorResult): void {
		if (!this.schema) {
			return;
		}

		const trimmedName = result.name.trim();
		const targetName = trimmedName.length > 0 ? trimmedName : field;
		const nameChanged = targetName !== field;
		let activeField = field;
		if (nameChanged) {
			const renamed = this.renameColumnField(field, targetName);
			if (!renamed) {
				new Notice(`重命名列失败：${targetName}`);
				return;
			}
			activeField = targetName;
		}

		const existingConfigs = this.schema.columnConfigs ?? [];
		const nextConfigs = existingConfigs.map((config) => ({ ...config }));
		let config = nextConfigs.find((item) => item.name === activeField);
		if (!config) {
			config = { name: activeField };
			nextConfigs.push(config);
		}

		if (result.type === 'formula') {
			config.formula = result.formula;
		} else {
			delete config.formula;
		}

		if (!this.hasColumnConfigContent(config)) {
			const index = nextConfigs.findIndex((item) => item.name === activeField);
			if (index !== -1) {
				nextConfigs.splice(index, 1);
			}
		}

		this.schema.columnConfigs = this.normalizeColumnConfigs(nextConfigs);
		this.persistColumnStructureChange();
	}

	/**
	 * 从 H2 块提取表格数据（转换为 RowData 格式）
	 */
	private extractTableData(blocks: H2Block[], schema: Schema): RowData[] {
		const data: RowData[] = [];
		const rowCount = blocks.length;

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

			for (const hiddenField of this.hiddenSortableFields) {
				if (hiddenField === '#') {
					continue;
				}
				row[hiddenField] = block.data[hiddenField] || '';
			}

			this.applyFormulaResults(row, rowCount);

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

		for (let blockIndex = 0; blockIndex < this.blocks.length; blockIndex++) {
			const block = this.blocks[blockIndex];
			const isSchemaBlock = blockIndex === 0;
			// 按照 schema 顺序输出
			let isFirstKey = true;

			for (const key of this.schema.columnNames) {
				const rawValue = block.data[key];
				const value = rawValue ?? '';
				const hasValue = value.trim().length > 0;

				if (isFirstKey) {
					// 第一个 key:value 作为 H2 标题
					lines.push(`## ${key}：${value}`);
					isFirstKey = false;
				} else {
					// 其他 key:value 作为正文
					if (hasValue) {
						lines.push(`${key}：${value}`);
					} else if (isSchemaBlock) {
						// schema 块需要保留空字段以维持列定义
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
			const markdown = this.blocksToMarkdown().trimEnd();
			await this.app.vault.modify(this.file, `${markdown}\n`);
			await this.saveConfigBlock();
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

		this.columnLayoutStore.reset(this.file.path);
		this.filterStateStore.setFilePath(this.file.path);
		this.filterStateStore.resetState();
		// 读取文件内容
		const content = await this.app.vault.read(this.file);

		// 尝试加载配置块（带缓存）
		const configBlock = await this.loadConfig();

		// 如果有配置块，应用配置
		if (configBlock) {
			if (configBlock.filterViews) {
				this.filterStateStore.setState(configBlock.filterViews);
			}
			if (configBlock.columnWidths) {
				this.columnLayoutStore.applyConfig(configBlock.columnWidths);
			}
		}

		this.filterViewState = this.filterStateStore.getState();

		// 解析头部配置块
		let columnConfigs = this.markdownParser.parseHeaderConfig(content);
		if ((!columnConfigs || columnConfigs.length === 0) && configBlock?.columnConfigs) {
			columnConfigs = this.deserializeColumnConfigs(configBlock.columnConfigs);
		}

		// 解析 H2 块
		const parsedBlocks = this.markdownParser.parseH2Blocks(content);
		if (parsedBlocks.length === 0) {
			container.createDiv({
				text: "此文件不包含 H2 块，无法显示为表格",
				cls: "tlb-warning"
			});
			return;
		}
		this.blocks = parsedBlocks;

		// 提取 Schema
		const schemaResult = this.schemaBuilder.buildSchema(this.blocks, columnConfigs ?? null);
		this.schema = schemaResult.schema;
		this.hiddenSortableFields = schemaResult.hiddenSortableFields;
		this.schemaDirty = schemaResult.schemaDirty;
		this.sparseCleanupRequired = schemaResult.sparseCleanupRequired;

		if (!this.schema) {
			container.createDiv({ text: "无法提取表格结构" });
			return;
		}

		this.prepareFormulaColumns(this.schema.columnConfigs ?? null);
		if (this.schemaDirty || this.sparseCleanupRequired) {
			this.scheduleSave();
			this.schemaDirty = false;
			this.sparseCleanupRequired = false;
		}

		// 提取数据
		const data = this.extractTableData(this.blocks, this.schema);
		this.allRowData = data; // 保存全部数据供过滤使用

		// 准备列定义（添加序号列）
		// 如果没有从配置块加载 filterViewState，则从插件设置加载
		if (!this.filterViewState || this.filterViewState.views.length === 0) {
			this.filterStateStore.loadFromSettings();
			this.filterViewState = this.filterStateStore.getState();
		}
		this.initialColumnState = null;
		if (this.filterViewBar) {
			this.filterViewBar.destroy();
			this.filterViewBar = null;
		}
		this.renderFilterViewControls(container);

		const primaryField = this.schema.columnNames[0] ?? null;

		const columns: ColumnDef[] = [
			{
				field: '#',
				headerName: '',
				headerTooltip: 'Index',
				editable: false  // 序号列只读
			},
			...this.schema.columnNames.map((name) => {
				const baseColDef: ColumnDef = {
					field: name,
					headerName: name,
					editable: true
				};
				const normalizedName = name.trim().toLowerCase();
				if (normalizedName === 'status') {
					baseColDef.headerName = '';
					baseColDef.headerTooltip = 'Status';
					(baseColDef as any).suppressMovable = true;
					(baseColDef as any).lockPosition = true;
					(baseColDef as any).lockPinned = true;
					(baseColDef as any).pinned = 'left';
					baseColDef.editable = false;
				}

				if (primaryField && name === primaryField) {
					(baseColDef as any).pinned = 'left';
					(baseColDef as any).lockPinned = true;
					(baseColDef as any).lockPosition = true;
					(baseColDef as any).suppressMovable = true;
				}

				// 应用头部配置对每列的定制
				if (this.schema?.columnConfigs) {
					const config = this.schema.columnConfigs.find(c => c.name === name);
					if (config) {
						this.applyWidthConfig(baseColDef, config);
					}
				}

				const isFormulaColumn = this.formulaColumns.has(name) || this.formulaCompileErrors.has(name);
				if (isFormulaColumn) {
					baseColDef.editable = false;
					(baseColDef as any).tooltipField = this.getFormulaTooltipField(name);
				}

				const storedWidth = this.getStoredColumnWidth(name);
				if (typeof storedWidth === "number" && name !== "#" && name !== "status") {
					const clamped = clampColumnWidth(storedWidth);
					(baseColDef as any).width = clamped;
					(baseColDef as any).__tlbStoredWidth = clamped;
					(baseColDef as any).suppressSizeToFit = true;
				}

				return baseColDef;
			})
		];

		// 根据 Obsidian 主题选择 AG Grid 主题（支持新窗口）
		const isDarkMode = ownerDoc.body.classList.contains('theme-dark');
		const themeClass = isDarkMode ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

		// 创建表格容器
		const tableContainer = container.createDiv({ cls: `tlb-table-container ${themeClass}` });

		const containerWindow = ownerDoc?.defaultView ?? window;
		debugLog('TableView.render container window', this.describeWindow(containerWindow));

		const mountGrid = () => {
			const result = this.gridController.mount(tableContainer, columns, data, {
				onStatusChange: (rowId: string, newStatus: TaskStatus) => {
					this.onStatusChange(rowId, newStatus);
				},
				onColumnResize: (field: string, width: number) => {
					this.handleColumnResize(field, width);
				},
				onCopyH2Section: (rowIndex: number) => {
					this.copyH2Section(rowIndex);
				},
				onColumnOrderChange: (fields: string[]) => {
					this.handleColumnOrderChange(fields);
				},
				onModelUpdated: () => this.handleGridModelUpdated(),
				onCellEdit: (event: CellEditEvent) => {
					this.onCellEdit(event);
				},
				onHeaderEdit: (event: HeaderEditEvent) => {
					this.handleHeaderEditEvent(event);
				},
				onColumnHeaderContextMenu: (field: string, event: MouseEvent) => {
					this.handleColumnHeaderContextMenu(field, event);
				},
				onEnterAtLastRow: (field: string | null) => {
					const oldRowCount = this.blocks.length;
					this.addRow(oldRowCount, {
						focusField: field ?? null
					});
				}
			});

			this.gridAdapter = result.gridAdapter;
			this.tableContainer = result.container;
			this.updateTableContainerSize();
			this.applyActiveFilterView();
			this.setupContextMenu(result.container);
			this.setupKeyboardShortcuts(result.container);
			this.setupResizeObserver(result.container);
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
			this.gridController.markLayoutDirty();
			this.gridController.resizeColumns();

			// 对于窗口/viewport/workspace 等事件，延迟再次尝试，确保布局稳定
			if (
				source === 'window resize' ||
				source === 'visualViewport resize' ||
				source === 'workspace resize'
			) {
				setTimeout(() => {
					this.gridController.resizeColumns();
				}, 200);

				setTimeout(() => {
					this.gridController.resizeColumns();
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
			const target = event.target as HTMLElement;
			const headerElement = target.closest('.ag-header-cell, .ag-header-group-cell') as HTMLElement | null;
			if (headerElement) {
				const headerColId = headerElement.getAttribute('col-id');
				if (headerColId && headerColId !== 'status' && headerColId !== '#') {
					event.preventDefault();
					event.stopPropagation();
					this.handleColumnHeaderContextMenu(headerColId, event);
				}
				return;
			}

			const cellElement = target.closest('.ag-cell');
			if (!cellElement) {
				return;
			}
			const colId = cellElement.getAttribute('col-id');

			if (colId === 'status') {
				return;
			}

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

			// 注意：Ctrl+C 在序号列的处理已移至 AgGridAdapter 的 onCellKeyDown 中

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
		const blockIndexes = this.resolveBlockIndexesForCopy(blockIndex);
		if (blockIndexes.length === 0) {
			return;
		}

		const segments: string[] = [];
		for (const index of blockIndexes) {
			const block = this.blocks[index];
			if (!block) {
				continue;
			}
			segments.push(this.blockToMarkdown(block));
		}

		if (segments.length === 0) {
			return;
		}

		const markdown = segments.join('\n\n');

		try {
			await navigator.clipboard.writeText(markdown);
			new Notice('已复制整段内容');
		} catch (error) {
			console.error('复制失败:', error);
			new Notice('复制失败');
		}
	}

	private resolveBlockIndexesForCopy(primaryIndex: number): number[] {
		const selected = this.gridAdapter?.getSelectedRows() ?? [];
		const validSelection = selected.filter((index) => index >= 0 && index < this.blocks.length);

		if (validSelection.length > 1 && validSelection.includes(primaryIndex)) {
			return validSelection;
		}

		if (primaryIndex >= 0 && primaryIndex < this.blocks.length) {
			return [primaryIndex];
		}

		if (validSelection.length > 0) {
			return validSelection;
		}

		return [];
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
	 * 获取当前激活过滤视图中的等值条件，作为新建条目的预填充
	 */
	private getActiveFilterPrefills(): Record<string, string> {
		const prefills: Record<string, string> = {};

		const activeId = this.filterViewState.activeViewId;
		if (!activeId) {
			return prefills;
		}

		const activeView = this.filterViewState.views.find((view) => view.id === activeId);
		if (!activeView || !activeView.filterRule) {
			return prefills;
		}

		for (const condition of activeView.filterRule.conditions) {
			if (condition.operator !== 'equals') {
				continue;
			}
			const rawValue = condition.value ?? '';
			if (rawValue.trim().length === 0) {
				continue;
			}
			if (condition.column === 'statusChanged') {
				continue;
			}
			prefills[condition.column] = rawValue;
		}

		return prefills;
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

		// 刷新数据缓存和视图
		this.refreshGridData();

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

	private handleHeaderEditEvent(event: HeaderEditEvent): void {
		if (!this.schema) {
			return;
		}
		const colIndex = this.schema.columnNames.indexOf(event.field);
		if (colIndex === -1) {
			return;
		}
		this.onHeaderEdit(colIndex, event.newName);
	}

	/**
	 * 处理表头编辑（Key:Value 格式）
	 * 重命名列名（key）
	 */
	private onHeaderEdit(colIndex: number, newValue: string): void {
		if (!this.schema || colIndex < 0 || colIndex >= this.schema.columnNames.length) {
			console.error('Invalid schema or column index');
			return;
		}
		const oldName = this.schema.columnNames[colIndex];
		const trimmed = newValue.trim();
		if (!trimmed || trimmed === oldName) {
			return;
		}
		const renamed = this.renameColumnField(oldName, trimmed);
		if (!renamed) {
			new Notice(`重命名列失败：${trimmed}`);
			return;
		}
		this.refreshGridData();
		this.scheduleSave();
	}

	// ==================== 预留：CRUD 操作接口（SchemaStore 架构） ====================
	// 这些方法签名为未来的 SchemaStore 集成预留接口，减少后续重构成本

	/**
	 * 添加新行（Key:Value 格式）
	 * @param beforeRowIndex 在指定行索引之前插入，undefined 表示末尾
	 */
	private addRow(beforeRowIndex?: number, options?: { focusField?: string | null }): void {
		if (!this.schema) {
			console.error('Schema not initialized');
			return;
		}

		const focusedCell = this.gridAdapter?.getFocusedCell?.();
		const focusField = options?.focusField !== undefined
			? options.focusField ?? null
			: focusedCell?.field ?? null;
		// 计算新条目编号
		const entryNumber = this.blocks.length + 1;
		const filterPrefills = this.getActiveFilterPrefills();

		// 创建新 H2Block（初始化所有 key）
		const newBlock: H2Block = {
			title: '',  // title 会在 blocksToMarkdown 时重新生成
			data: {}
		};

		// 为所有列初始化值
		for (let i = 0; i < this.schema.columnNames.length; i++) {
			const key = this.schema.columnNames[i];
			const prefilledValue = filterPrefills[key];

			if (prefilledValue !== undefined) {
				newBlock.data[key] = prefilledValue;
			} else if (key === 'status') {
				newBlock.data[key] = 'todo';
			} else if (i === 0) {
				newBlock.data[key] = `新条目 ${entryNumber}`;
			} else {
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

		// 刷新数据缓存和视图
		this.refreshGridData();

		const insertIndex = (beforeRowIndex !== undefined && beforeRowIndex !== null)
			? beforeRowIndex
			: this.blocks.length - 1;
		this.focusRow(insertIndex, focusField ?? undefined);

		// 触发保存
		this.scheduleSave();
	}

	/**
	 * 聚焦并选中指定行，保持视图位置
	 */
	private focusRow(
		rowIndex: number,
		field?: string,
		options?: { retryCount?: number; retryDelay?: number }
	): void {
		if (!this.schema) {
			debugLog('[FocusDebug]', 'focusRow: missing schema', { rowIndex, field });
			return;
		}

		if (rowIndex < 0 || rowIndex >= this.blocks.length) {
			debugLog('[FocusDebug]', 'focusRow: index out of range', {
				rowIndex,
				field,
				blockCount: this.blocks.length
			});
			return;
		}

		const maxRetries = Math.max(1, options?.retryCount ?? 20);
		const retryDelay = Math.max(20, options?.retryDelay ?? 80);

		this.clearPendingFocus('replace-request');

		this.pendingFocusRequest = {
			rowIndex,
			field: field ?? null,
			maxRetries,
			retriesLeft: maxRetries,
			retryDelay,
			pendingVerification: false
		};

		debugLog('[FocusDebug]', 'focusRow: request registered', {
			rowIndex,
			field: field ?? null,
			maxRetries,
			retryDelay,
			visibleRowCount: this.visibleRowData.length
		});

		this.scheduleFocusAttempt(0, 'initial');
	}

	private scheduleFocusAttempt(delay: number, reason: string): void {
		const request = this.pendingFocusRequest;
		if (!request) {
			debugLog('[FocusDebug]', 'scheduleFocusAttempt: no pending request', { reason, delay });
			return;
		}

		const effectiveDelay = Math.max(0, delay);

		if (this.focusRetryTimer) {
			clearTimeout(this.focusRetryTimer);
			this.focusRetryTimer = null;
		}

		debugLog('[FocusDebug]', 'scheduleFocusAttempt', {
			reason,
			delay: effectiveDelay,
			rowIndex: request.rowIndex,
			field: request.field ?? null,
			retriesLeft: request.retriesLeft,
			pendingVerification: request.pendingVerification
		});

		this.focusRetryTimer = setTimeout(() => {
			this.focusRetryTimer = null;
			this.attemptFocusOnPendingRow();
		}, effectiveDelay);
	}

	private attemptFocusOnPendingRow(): void {
		const request = this.pendingFocusRequest;
		if (!request) {
			debugLog('[FocusDebug]', 'attemptFocus: skipped (no request)');
			return;
		}

		const attemptIndex = request.maxRetries - request.retriesLeft + 1;

		if (!this.gridAdapter || !this.schema) {
			debugLog('[FocusDebug]', 'attemptFocus: grid/schema not ready', {
				rowIndex: request.rowIndex,
				field: request.field ?? null,
				attemptIndex,
				retriesLeft: request.retriesLeft
			});
			this.handleFocusRetry(request, 'grid-not-ready');
			return;
		}

		const fallbackField = this.schema.columnNames[0] ?? null;
		const targetField = (request.field && request.field !== ROW_ID_FIELD) ? request.field : fallbackField;
		const targetRowId = String(request.rowIndex);

		const adapter: any = this.gridAdapter;
		const api = adapter.gridApi;
		if (!api) {
			debugLog('[FocusDebug]', 'attemptFocus: grid API unavailable', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex,
				retriesLeft: request.retriesLeft
			});
			this.handleFocusRetry(request, 'missing-api');
			return;
		}

		let targetNode: any = null;

		if (typeof api.getRowNode === 'function') {
			targetNode = api.getRowNode(targetRowId);
		}

		if (!targetNode && typeof api.forEachNodeAfterFilterAndSort === 'function') {
			api.forEachNodeAfterFilterAndSort((node: any) => {
				if (targetNode) {
					return;
				}
				const nodeId = String(node?.data?.[ROW_ID_FIELD] ?? '');
				if (nodeId === targetRowId) {
					targetNode = node;
				}
			});
		}

		if (!targetNode) {
			debugLog('[FocusDebug]', 'attemptFocus: target node missing', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex,
				retriesLeft: request.retriesLeft
			});
			this.handleFocusRetry(request, 'node-missing');
			return;
		}

		const displayedIndex = typeof targetNode.rowIndex === 'number'
			? targetNode.rowIndex
			: null;

		const effectiveIndex = displayedIndex ?? this.visibleRowData.findIndex(
			(row) => String(row?.[ROW_ID_FIELD]) === targetRowId
		);

		if (effectiveIndex === -1 || effectiveIndex === null) {
			debugLog('[FocusDebug]', 'attemptFocus: effective index not found', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex,
				retriesLeft: request.retriesLeft,
				visibleRowCount: this.visibleRowData.length
			});
			this.handleFocusRetry(request, 'index-missing');
			return;
		}

		const focusedCell = typeof api.getFocusedCell === 'function' ? api.getFocusedCell() : null;
		const focusedColumnId = focusedCell?.column
			? (typeof focusedCell.column.getColId === 'function'
				? focusedCell.column.getColId()
				: typeof focusedCell.column.getId === 'function'
					? focusedCell.column.getId()
					: focusedCell.column.colId ?? null)
			: null;

		const hasFocus =
			focusedCell != null &&
			focusedCell.rowIndex === effectiveIndex &&
			(!targetField || focusedColumnId === targetField);

		if (request.pendingVerification) {
			if (hasFocus) {
				debugLog('[FocusDebug]', 'attemptFocus: verification success', {
					rowIndex: request.rowIndex,
					field: targetField,
					attemptIndex
				});
				this.clearPendingFocus('verification-success');
				return;
			}
			debugLog('[FocusDebug]', 'attemptFocus: verification failed', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex
			});
			request.pendingVerification = false;
			this.handleFocusRetry(request, 'verification-failed');
			return;
		}

		if (hasFocus) {
			debugLog('[FocusDebug]', 'attemptFocus: already focused', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex
			});
			this.clearPendingFocus('already-focused');
			return;
		}

		if (typeof targetNode.setSelected === 'function') {
			targetNode.setSelected(true, true);
		} else {
			this.gridAdapter.selectRow?.(request.rowIndex, { ensureVisible: true });
		}

		if (typeof api.ensureNodeVisible === 'function') {
			api.ensureNodeVisible(targetNode, 'middle');
		} else if (typeof api.ensureIndexVisible === 'function') {
			api.ensureIndexVisible(effectiveIndex, 'middle');
		}

		if (targetField && typeof api.setFocusedCell === 'function') {
			api.setFocusedCell(effectiveIndex, targetField);
		}

		debugLog('[FocusDebug]', 'attemptFocus: issued focus command', {
			rowIndex: request.rowIndex,
			field: targetField,
			attemptIndex,
			retriesLeft: request.retriesLeft
		});

		request.pendingVerification = true;
		this.scheduleFocusAttempt(Math.max(30, Math.floor(request.retryDelay / 2)), 'verification-delay');
	}

	private handleFocusRetry(request: PendingFocusRequest, reason: string): void {
		if (!this.pendingFocusRequest || request !== this.pendingFocusRequest) {
			return;
		}

		if (request.pendingVerification) {
			request.pendingVerification = false;
		}

		if (request.retriesLeft <= 1) {
			debugLog('[FocusDebug]', 'handleFocusRetry: exhausted', {
				reason,
				rowIndex: request.rowIndex,
				field: request.field ?? null
			});
			this.clearPendingFocus('exhausted');
			return;
		}

		request.retriesLeft -= 1;
		debugLog('[FocusDebug]', 'handleFocusRetry: scheduling retry', {
			reason,
			rowIndex: request.rowIndex,
			field: request.field ?? null,
			retriesLeft: request.retriesLeft
		});
		this.scheduleFocusAttempt(request.retryDelay, `retry:${reason}`);
	}

	private clearPendingFocus(reason?: string): void {
		if (this.focusRetryTimer) {
			clearTimeout(this.focusRetryTimer);
			this.focusRetryTimer = null;
		}

		if (this.pendingFocusRequest) {
			debugLog('[FocusDebug]', 'clearPendingFocus', {
				reason: reason ?? 'unknown',
				rowIndex: this.pendingFocusRequest.rowIndex,
				field: this.pendingFocusRequest.field ?? null
			});
		} else {
			debugLog('[FocusDebug]', 'clearPendingFocus', {
				reason: reason ?? 'unknown',
				skipped: true
			});
		}

		this.pendingFocusRequest = null;
	}

	private handleGridModelUpdated(): void {
		if (!this.pendingFocusRequest) {
			debugLog('[FocusDebug]', 'handleGridModelUpdated: no pending request');
			return;
		}
		debugLog('[FocusDebug]', 'handleGridModelUpdated: reschedule', {
			rowIndex: this.pendingFocusRequest.rowIndex,
			field: this.pendingFocusRequest.field ?? null,
			retriesLeft: this.pendingFocusRequest.retriesLeft
		});
		this.scheduleFocusAttempt(0, 'model-updated');
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

		// 刷新数据缓存和视图
		this.refreshGridData();

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

		// 刷新数据缓存和视图
		this.refreshGridData();

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

		// 刷新数据缓存和视图
		this.refreshGridData();

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

		// 刷新数据缓存和视图
		this.refreshGridData();

		const newIndex = rowIndex + 1;
		this.focusRow(newIndex, focusedCell?.field);

		// 触发保存
		this.scheduleSave();
	}

	private duplicateColumn(field: string): void {
		if (!this.schema) {
			return;
		}
		const baseName = `${field} (副本)`;
		let candidate = baseName;
		let counter = 2;
		while (this.schema.columnNames.includes(candidate)) {
			candidate = `${baseName} ${counter}`;
			counter++;
		}
		const created = this.insertColumnInternal({
			newName: candidate,
			afterField: field,
			templateField: field,
			copyData: true
		});
		if (!created) {
			new Notice('复制列失败，请稍后重试');
			return;
		}
		this.persistColumnStructureChange({ notice: `已复制列：${candidate}` });
		this.openColumnEditModal(candidate);
	}

	private insertColumnAfter(field: string): void {
		if (!this.schema) {
			return;
		}
		const newName = this.generateUniqueColumnName('新列');
		const created = this.insertColumnInternal({
			newName,
			afterField: field
		});
		if (!created) {
			new Notice('插入新列失败，请稍后重试');
			return;
		}
		this.persistColumnStructureChange({ notice: `已插入列：${newName}` });
		this.openColumnEditModal(newName);
	}

	private removeColumn(field: string): void {
		if (!this.schema) {
			return;
		}
		const target = field.trim();
		if (!target || target === '#' || target === 'status' || target === ROW_ID_FIELD) {
			return;
		}
		const index = this.schema.columnNames.indexOf(target);
		if (index === -1) {
			return;
		}
		this.schema.columnNames.splice(index, 1);

		if (this.schema.columnConfigs && this.schema.columnConfigs.length > 0) {
			const nextConfigs = this.schema.columnConfigs.filter((config) => config.name !== target);
			this.schema.columnConfigs = this.normalizeColumnConfigs(nextConfigs);
		}

		this.columnLayoutStore.remove(target);

		this.hiddenSortableFields.delete(target);
		this.formulaColumns.delete(target);
		this.formulaCompileErrors.delete(target);
		const orderIndex = this.formulaColumnOrder.indexOf(target);
		if (orderIndex !== -1) {
			this.formulaColumnOrder.splice(orderIndex, 1);
		}

		for (const block of this.blocks) {
			if (Object.prototype.hasOwnProperty.call(block.data, target)) {
				delete block.data[target];
			}
		}

		this.removeColumnFromFilterViews(target);
		this.persistColumnStructureChange({ notice: `已删除列：${target}` });
	}

	private insertColumnInternal(options: {
		newName: string;
		afterField?: string | null;
		templateField?: string | null;
		copyData?: boolean;
	}): boolean {
		if (!this.schema) {
			return false;
		}
		const trimmedName = options.newName.trim();
		if (!trimmedName || this.schema.columnNames.includes(trimmedName)) {
			return false;
		}
		let insertIndex = this.schema.columnNames.length;
		if (options.afterField) {
			const idx = this.schema.columnNames.indexOf(options.afterField);
			if (idx !== -1) {
				insertIndex = idx + 1;
			}
		}
		this.schema.columnNames.splice(insertIndex, 0, trimmedName);

		const templateField = options.templateField ?? null;
		const currentConfigs = this.schema.columnConfigs ?? [];
		const clonedConfigs = currentConfigs.map((config) => ({ ...config }));
		if (templateField) {
			const sourceConfig = currentConfigs.find((config) => config.name === templateField) ?? null;
			if (sourceConfig) {
				clonedConfigs.push({ ...sourceConfig, name: trimmedName });
			} else {
				const compiled = this.formulaColumns.get(templateField);
				if (compiled) {
					clonedConfigs.push({ name: trimmedName, formula: compiled.original });
				}
			}
		}
		this.schema.columnConfigs = this.normalizeColumnConfigs(clonedConfigs);

		const shouldCopyData = Boolean(options.copyData && templateField);
		for (const block of this.blocks) {
			const baseValue = shouldCopyData && templateField
				? block.data[templateField] ?? ''
				: '';
			block.data[trimmedName] = baseValue;
		}

		if (templateField) {
			this.columnLayoutStore.clone(templateField, trimmedName);
		}

		if (templateField && this.hiddenSortableFields.has(templateField)) {
			this.hiddenSortableFields.add(trimmedName);
		}

		return true;
	}

	private persistColumnStructureChange(options?: { notice?: string }): void {
		if (!this.schema) {
			return;
		}
		this.prepareFormulaColumns(this.schema.columnConfigs ?? null);
		this.refreshGridData();
		if (options?.notice) {
			new Notice(options.notice);
		}
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		void (async () => {
			try {
				await this.saveToFile();
				await this.render();
			} catch (error) {
				console.error(`${LOG_PREFIX} Failed to persist column change`, error);
			}
		})();
	}

	private normalizeColumnConfigs(configs: ColumnConfig[] | undefined): ColumnConfig[] | undefined {
		if (!configs || configs.length === 0) {
			return undefined;
		}
		if (!this.schema) {
			return configs;
		}
		const orderMap = new Map<string, number>();
		this.schema.columnNames.forEach((name, index) => orderMap.set(name, index));
		const filtered = configs.filter((config) => orderMap.has(config.name));
		if (filtered.length === 0) {
			return undefined;
		}
		filtered.sort((a, b) => (orderMap.get(a.name) ?? 0) - (orderMap.get(b.name) ?? 0));
		return filtered;
	}

	private generateUniqueColumnName(base: string): string {
		const normalizedBase = base.trim().length > 0 ? base.trim() : '新列';
		if (!this.schema) {
			return normalizedBase;
		}
		const existing = new Set(this.schema.columnNames);
		if (!existing.has(normalizedBase)) {
			return normalizedBase;
		}
		let counter = 2;
		let candidate = `${normalizedBase} ${counter}`;
		while (existing.has(candidate)) {
			counter++;
			candidate = `${normalizedBase} ${counter}`;
		}
		return candidate;
	}

	private renameColumnField(oldName: string, newName: string): boolean {
		if (!this.schema) {
			return false;
		}
		const trimmed = newName.trim();
		if (!trimmed || trimmed === '#' || trimmed === 'status' || trimmed === ROW_ID_FIELD) {
			return false;
		}
		if (trimmed === oldName) {
			return true;
		}
		if (this.schema.columnNames.includes(trimmed)) {
			return false;
		}
		const index = this.schema.columnNames.indexOf(oldName);
		if (index === -1) {
			return false;
		}
		this.schema.columnNames[index] = trimmed;

		if (this.schema.columnConfigs && this.schema.columnConfigs.length > 0) {
			const nextConfigs = this.schema.columnConfigs.map((config) => ({ ...config }));
			for (const config of nextConfigs) {
				if (config.name === oldName) {
					config.name = trimmed;
				}
			}
			this.schema.columnConfigs = this.normalizeColumnConfigs(nextConfigs);
		}

		this.columnLayoutStore.rename(oldName, trimmed);

		if (this.hiddenSortableFields.has(oldName)) {
			this.hiddenSortableFields.delete(oldName);
			this.hiddenSortableFields.add(trimmed);
		}

		this.renameColumnInFilterViews(oldName, trimmed);

		for (const block of this.blocks) {
			if (Object.prototype.hasOwnProperty.call(block.data, oldName)) {
				const value = block.data[oldName];
				delete block.data[oldName];
				block.data[trimmed] = value;
			}
		}

		return true;
	}

	private renameColumnInFilterViews(oldName: string, newName: string): void {
		if (!this.filterViewState || !Array.isArray(this.filterViewState.views)) {
			return;
		}
		for (const view of this.filterViewState.views) {
			let modified = false;
			if (view.filterRule) {
				for (const condition of view.filterRule.conditions) {
					if (condition.column === oldName) {
						condition.column = newName;
						modified = true;
					}
				}
			}
			if (Array.isArray(view.sortRules)) {
				for (const rule of view.sortRules) {
					if (rule.column === oldName) {
						rule.column = newName;
						modified = true;
					}
				}
			}
			if (modified) {
				view.columnState = null;
			}
		}
	}

	private removeColumnFromFilterViews(column: string): void {
		if (!this.filterViewState || !Array.isArray(this.filterViewState.views)) {
			return;
		}
		for (const view of this.filterViewState.views) {
			let modified = false;
			if (view.filterRule) {
				const conditions = view.filterRule.conditions.filter((condition) => condition.column !== column);
				if (conditions.length !== view.filterRule.conditions.length) {
					view.filterRule.conditions = conditions;
					modified = true;
				}
				if (view.filterRule.conditions.length === 0) {
					view.filterRule = null;
					modified = true;
				}
			}
			if (Array.isArray(view.sortRules)) {
				const nextSort = view.sortRules.filter((rule) => rule.column !== column);
				if (nextSort.length !== view.sortRules.length) {
					view.sortRules = nextSort;
					modified = true;
				}
			}
			if (modified) {
				view.columnState = null;
			}
		}
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
		this.filterViewBar = new FilterViewBar({
			container,
			renderQuickFilter: (searchContainer) => this.renderGlobalQuickFilter(searchContainer),
			callbacks: {
				onCreate: () => {
					void this.filterViewController.promptCreateFilterView();
				},
				onActivate: (viewId) => {
					this.filterViewController.activateFilterView(viewId);
				},
				onContextMenu: (view, event) => {
					this.filterViewController.openFilterViewMenu(view, event);
				},
				onReorder: (draggedId, targetId) => {
					this.filterViewController.reorderFilterViews(draggedId, targetId);
				}
			}
		});
		this.filterViewBar.render(this.filterViewState);
	}

	private renderGlobalQuickFilter(container: HTMLElement): void {
		if (this.globalQuickFilterUnsubscribe) {
			this.globalQuickFilterUnsubscribe();
			this.globalQuickFilterUnsubscribe = null;
		}

		this.globalQuickFilterInputEl = null;
		this.globalQuickFilterClearEl = null;

		container.addClass('tlb-filter-view-search');
		container.setAttribute('role', 'search');

		const clearButton = container.createSpan({ cls: 'clickable-icon' });
		clearButton.setAttribute('role', 'button');
		clearButton.setAttribute('tabindex', '0');
		clearButton.setAttribute('aria-label', '清除过滤');
		setIcon(clearButton, 'x');

		const input = container.createEl('input', {
			type: 'search',
			placeholder: '全局过滤'
		});
		input.setAttribute('aria-label', '全局过滤关键字');
		input.setAttribute('size', '16');
		const currentValue = globalQuickFilterManager.getValue();
		input.value = currentValue;
		this.globalQuickFilterInputEl = input;

		const iconEl = container.createSpan({ cls: 'clickable-icon' });
		iconEl.setAttribute('aria-label', '聚焦过滤输入');
		iconEl.setAttribute('tabindex', '0');
		setIcon(iconEl, 'search');
		clearButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.clearGlobalQuickFilter();
		});
		clearButton.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				event.stopPropagation();
				this.clearGlobalQuickFilter();
			}
		});
		this.globalQuickFilterClearEl = clearButton;
		this.updateGlobalQuickFilterIndicators(currentValue);

		iconEl.addEventListener('click', () => {
			input.focus();
		});
		iconEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				event.stopPropagation();
				input.focus();
			}
		});

		input.addEventListener('input', () => {
			this.onGlobalQuickFilterInput(input.value);
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				if (input.value.length > 0) {
					this.clearGlobalQuickFilter();
				} else {
					input.blur();
				}
			}
		});

		this.globalQuickFilterUnsubscribe = globalQuickFilterManager.subscribe((value, source) => {
			if (source === this) {
				return;
			}
			this.updateGlobalQuickFilterInput(value);
			this.applyGlobalQuickFilter(value);
		});

		if (!this.hasRegisteredGlobalQuickFilter) {
			this.hasRegisteredGlobalQuickFilter = true;
			globalQuickFilterManager.incrementHost();
		}
	}

	private onGlobalQuickFilterInput(rawValue: string): void {
		const value = rawValue ?? '';
		this.applyGlobalQuickFilter(value);
		if (value === globalQuickFilterManager.getValue()) {
			return;
		}
		globalQuickFilterManager.emit(value, this);
	}

	private applyGlobalQuickFilter(value: string): void {
		if (this.gridAdapter && typeof this.gridAdapter.setQuickFilter === 'function') {
			this.gridAdapter.setQuickFilter(value);
		}
		this.updateGlobalQuickFilterIndicators(value);
	}

	private updateGlobalQuickFilterInput(value: string): void {
		if (this.globalQuickFilterInputEl && this.globalQuickFilterInputEl.value !== value) {
			const input = this.globalQuickFilterInputEl;
			const isFocused = document.activeElement === input;
			input.value = value;
			if (isFocused) {
				const caret = typeof input.selectionEnd === 'number' ? Math.min(value.length, input.selectionEnd) : value.length;
				input.setSelectionRange(caret, caret);
			}
		}
		this.updateGlobalQuickFilterIndicators(value);
	}

	private updateGlobalQuickFilterIndicators(value: string): void {
		if (!this.globalQuickFilterClearEl) {
			return;
		}
		if (value && value.length > 0) {
			this.globalQuickFilterClearEl.removeAttribute('hidden');
			(this.globalQuickFilterClearEl as HTMLElement).style.display = '';
		} else {
			this.globalQuickFilterClearEl.setAttribute('hidden', 'true');
			(this.globalQuickFilterClearEl as HTMLElement).style.display = 'none';
		}
	}

	private clearGlobalQuickFilter(): void {
		if (!this.globalQuickFilterInputEl) {
			return;
		}
		if (this.globalQuickFilterInputEl.value.length === 0 && !globalQuickFilterManager.getValue()) {
			return;
		}
		this.globalQuickFilterInputEl.value = '';
		this.applyGlobalQuickFilter('');
		globalQuickFilterManager.emit('', this);
		this.globalQuickFilterInputEl.focus();
	}

	private cleanupGlobalQuickFilter(): void {
		if (this.globalQuickFilterUnsubscribe) {
			this.globalQuickFilterUnsubscribe();
			this.globalQuickFilterUnsubscribe = null;
		}
		this.globalQuickFilterInputEl = null;
		this.globalQuickFilterClearEl = null;
		if (this.hasRegisteredGlobalQuickFilter) {
			this.hasRegisteredGlobalQuickFilter = false;
			globalQuickFilterManager.decrementHost();
		}
	}

	private reapplyGlobalQuickFilter(): void {
		this.applyGlobalQuickFilter(globalQuickFilterManager.getValue());
	}

	private syncFilterViewState(): void {
		this.filterViewState = this.filterStateStore.getState();
	}


	/**
	 * 刷新表格数据（同步 allRowData 并重新应用过滤视图）
	 * 所有数据修改操作（增删改）后都应该调用此方法
	 */
	private refreshGridData(): void {
		if (!this.schema || !this.gridAdapter) {
			return;
		}

		// 从 blocks 重新提取完整数据
		this.allRowData = this.extractTableData(this.blocks, this.schema);

		// 根据当前激活的过滤视图决定显示哪些数据
		const targetId = this.filterViewState.activeViewId;
		const targetView = targetId ? this.filterViewState.views.find((view) => view.id === targetId) ?? null : null;

		const sortRules = targetView?.sortRules ?? [];
		const filteredRows = !targetView || !targetView.filterRule
			? this.allRowData
			: FilterDataProcessor.applyFilterRule(this.allRowData, targetView.filterRule);
		const sortedRows = FilterDataProcessor.sortRowData(filteredRows, sortRules);
		this.visibleRowData = sortedRows;
		this.gridAdapter.updateData(sortedRows);
		this.applySortModelToGrid(sortRules);
		this.reapplyGlobalQuickFilter();
	}

	private applyActiveFilterView(): void {
		if (!this.gridAdapter) {
			return;
		}
		const targetId = this.filterViewState.activeViewId;
		const targetView = targetId ? this.filterViewState.views.find((view) => view.id === targetId) ?? null : null;

		const sortRules = targetView?.sortRules ?? [];
		const resolveDataToShow = (): RowData[] => {
			const baseRows = !targetView || !targetView.filterRule
				? this.allRowData
				: FilterDataProcessor.applyFilterRule(this.allRowData, targetView.filterRule!);
			return FilterDataProcessor.sortRowData(baseRows, sortRules);
		};

		const applyData = () => {
			if (!this.gridAdapter) {
				return;
			}
			const dataToShow = resolveDataToShow();
			this.visibleRowData = dataToShow;

			const api = (this.gridAdapter as any).gridApi;
			if (api && typeof api.setGridOption === 'function') {
				api.setGridOption('rowData', dataToShow);
			} else {
				this.gridAdapter.updateData(dataToShow);
			}
			this.applySortModelToGrid(sortRules);
			this.reapplyGlobalQuickFilter();
		};

		if (this.gridAdapter.runWhenReady) {
			this.gridAdapter.runWhenReady(() => applyData());
		} else {
			applyData();
		}
	}

	private applySortModelToGrid(sortRules: SortRule[]): void {
		if (!this.gridAdapter?.setSortModel) {
			return;
		}
		const model: SortModelEntry[] = [];
		const visibleColumns = new Set<string>();
		if (this.schema?.columnNames) {
			for (const column of this.schema.columnNames) {
				visibleColumns.add(column);
			}
		}
		const columnState = this.gridAdapter?.getColumnState?.();
		if (columnState) {
			for (const state of columnState) {
				if (state.colId) {
					visibleColumns.add(state.colId);
				}
			}
		}
		for (const rule of sortRules ?? []) {
			if (typeof rule?.column !== 'string' || rule.column.length === 0) {
				continue;
			}
			if (!visibleColumns.has(rule.column)) {
				continue;
			}
			model.push({
				field: rule.column,
				direction: rule.direction === 'desc' ? 'desc' : 'asc'
			});
		}
		this.gridAdapter.setSortModel(model);
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

	private getAvailableColumns(): string[] {
		const result: string[] = [];
		const seen = new Set<string>();
		const exclude = new Set<string>(['#', ROW_ID_FIELD, '__tlb_status', '__tlb_index']);

		const pushColumn = (value: string | undefined | null) => {
			if (!value) {
				return;
			}
			if (exclude.has(value)) {
				return;
			}
			if (value.startsWith('ag-Grid')) {
				return;
			}
			if (seen.has(value)) {
				return;
			}
			seen.add(value);
			result.push(value);
		};

		if (this.schema?.columnNames) {
			for (const column of this.schema.columnNames) {
				pushColumn(column);
			}
		} else {
			const columnState = this.gridAdapter?.getColumnState?.();
			if (columnState) {
				for (const state of columnState) {
					pushColumn(state.colId ?? undefined);
				}
			}
		}

		for (const hidden of this.hiddenSortableFields) {
			pushColumn(hidden);
		}

		return result;
	}

	private persistFilterViews(): Promise<void> | void {
		if (!this.file) {
			return;
		}

		// 保存到配置块（带缓存）
		this.saveConfigBlock().catch((error) => {
			console.error('[TileLineBase] Failed to save config block:', error);
		});

		// 同步到插件设置（向后兼容）
		return this.filterStateStore.persist();
	}

	/**
	 * 生成文件唯一ID（UUID前8位）
	 */
	private generateFileId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			const uuid = crypto.randomUUID();
			return uuid.split('-')[0]; // 取前8位
		}
		// 备用方案
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	}

	/**
	 * 从 metadataCache.headings 提取元数据
	 * 格式：## tlb <fileId> <version>
	 */
	private extractMetadataFromHeadings(file: TFile): { fileId: string; version: number } | null {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.headings) return null;

		// 找到最后一个 "## tlb ..." 标题
		const tlbHeading = cache.headings
			.filter(h => h.level === 2 && h.heading.startsWith('tlb '))
			.pop();

		if (!tlbHeading) return null;

		// 解析：## tlb 550e8400 1705123456789
		const parts = tlbHeading.heading.split(' ');
		if (parts.length !== 3) return null;

		const fileId = parts[1];
		const version = parseInt(parts[2], 10);

		if (!fileId || isNaN(version)) return null;

		return { fileId, version };
	}

	/**
	 * 解析完整配置块
	 * 查找最后一个 "## tlb <fileId> <version>" 后的 ```tlb ... ``` 块
	 */
	private parseConfigBlock(content: string, fileId: string): Record<string, any> | null {
		// 找到最后一个 "## tlb <fileId> <version>" 的位置
		const headerRegex = new RegExp(`^## tlb ${fileId} \\d+$`, 'gm');
		let lastMatch: RegExpExecArray | null = null;
		let match: RegExpExecArray | null;

		while ((match = headerRegex.exec(content)) !== null) {
			lastMatch = match;
		}

		if (!lastMatch) return null;

		// 从该位置开始，找到下一个 ```tlb ... ``` 块
		const afterHeader = content.substring(lastMatch.index);
		const blockRegex = /```tlb\s*\n([\s\S]*?)\n```/;
		const blockMatch = afterHeader.match(blockRegex);

		if (!blockMatch) return null;

		// 逐行解析配置
		const lines = blockMatch[1].split(/\r?\n/); // 兼容 CRLF
		const config: any = {};

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			const colonIndex = trimmed.indexOf(':');
			if (colonIndex === -1) continue;

			const key = trimmed.substring(0, colonIndex);
			const valueJson = trimmed.substring(colonIndex + 1);

			try {
				config[key] = JSON.parse(valueJson);
			} catch (error) {
				console.error(`[TileLineBase] Failed to parse config line: ${key}`, error);
			}
		}

		return config;
	}

	/**
	 * 加载配置（带缓存机制）
	 */
	private async loadConfig(): Promise<Record<string, any> | null> {
		if (!this.file) return null;

		// 1. 从 metadataCache.headings 快速提取元数据
		const meta = this.extractMetadataFromHeadings(this.file);

		if (!meta) {
			// 无配置块标题，返回 null（稍后自动迁移）
			return null;
		}

		this.fileId = meta.fileId;

		// 2. 查询缓存
		const plugin = getPluginContext();
		const cacheManager = plugin?.cacheManager;
		const cachedVersion = cacheManager?.getCachedVersion(meta.fileId);

		if (cachedVersion === meta.version) {
			// 缓存命中，直接返回 ✨
			const cached = cacheManager?.getCache(meta.fileId);
			if (cached) {
				console.log('[TileLineBase] Cache hit for file:', this.file.path);
				return cached as Record<string, any>;
			}
		}

		// 3. 缓存失效，读取文件并解析配置块
		console.log('[TileLineBase] Cache miss, parsing config block...');
		const content = await this.app.vault.read(this.file);
		const config = this.parseConfigBlock(content, meta.fileId);

		if (!config) {
			console.warn('[TileLineBase] Failed to parse config block');
			return null;
		}

		// 4. 更新缓存
		if (cacheManager) {
			cacheManager.setCache(meta.fileId, this.file.path, meta.version, config);
		}

		return config;
	}

	/**
	 * 保存配置块（二级标题 + 配置块）
	 */
	private async saveConfigBlock(): Promise<void> {
		if (!this.file) return;

		// 确保有 fileId
		if (!this.fileId) {
			this.fileId = this.generateFileId();
		}

		// 更新版本号
		const version = Date.now();

		// 构造配置块内容
		const lines: string[] = [];

		if (this.filterViewState) {
			lines.push(`filterViews:${JSON.stringify(this.filterViewState)}`);
		}
		const widthPrefs = this.columnLayoutStore.exportPreferences();
		if (Object.keys(widthPrefs).length > 0) {
			lines.push(`columnWidths:${JSON.stringify(widthPrefs)}`);
		}
		if (this.schema?.columnConfigs && this.schema.columnConfigs.length > 0) {
			const serializedColumns = this.schema.columnConfigs
				.filter((config) => this.hasColumnConfigContent(config))
				.map((config) => this.serializeColumnConfig(config));
			if (serializedColumns.length > 0) {
				lines.push(`columnConfigs:${JSON.stringify(serializedColumns)}`);
			}
		}
		lines.push(`viewPreference:table`);

		const configBlock = `\`\`\`tlb\n${lines.join('\n')}\n\`\`\``;

		// 读取当前文件内容
		const content = await this.app.vault.read(this.file);

		// 移除旧的配置块（包括标题和代码块）
		// 匹配：## tlb <id> <version> 后跟 ```tlb ... ```
		const oldConfigRegex = new RegExp(
			`## tlb ${this.fileId} \\d+\\s*\\n\`\`\`tlb\\s*\\n[\\s\\S]*?\\n\`\`\``,
			'g'
		);
		let newContent = content.replace(oldConfigRegex, '');

		// 如果没找到旧配置块，尝试移除任意配置块
		if (newContent === content) {
			newContent = content.replace(/## tlb \w+ \d+\s*\n```tlb\s*\n[\s\S]*?\n```/g, '');
		}

		// 在文件末尾添加新配置块
		const fullConfigBlock = `## tlb ${this.fileId} ${version}\n${configBlock}`;
		newContent = `${newContent.trimEnd()}\n\n${fullConfigBlock}\n`;

		await this.app.vault.modify(this.file, newContent);

		// 更新缓存
		const plugin = getPluginContext();
		const cacheManager = plugin?.cacheManager;
		if (cacheManager) {
			const config: Record<string, any> = {
				filterViews: this.filterViewState,
				columnWidths: widthPrefs,
				columnConfigs: this.schema?.columnConfigs
					? this.schema.columnConfigs
						.filter((cfg) => this.hasColumnConfigContent(cfg))
						.map((cfg) => this.serializeColumnConfig(cfg))
					: [],
				viewPreference: 'table'
			};
			cacheManager.setCache(this.fileId, this.file.path, version, config);
		}

		// 同步到插件设置（向后兼容）
		if (plugin) {
			if (this.filterViewState) {
				await plugin.saveFilterViewsForFile(this.file.path, this.filterViewState);
			}
			if (Object.keys(widthPrefs).length > 0) {
				for (const [field, width] of Object.entries(widthPrefs)) {
					plugin.updateColumnWidthPreference(this.file.path, field, width);
				}
			}
		}
	}

	async onClose(): Promise<void> {
		this.cleanupGlobalQuickFilter();
		if (this.filterViewBar) {
			this.filterViewBar.destroy();
			this.filterViewBar = null;
		}

		// 清理事件监听器
		this.cleanupEventListeners();

		// 隐藏右键菜单
		this.hideContextMenu();
		this.clearPendingFocus('view-close');

		// 销毁表格实例
		this.gridController.destroy();
		this.gridAdapter = null;
		this.tableContainer = null;

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

type ColumnFieldType = 'text' | 'formula';

interface ColumnEditorResult {
	name: string;
	type: ColumnFieldType;
	formula: string;
}

interface ColumnEditorModalOptions {
	columnName: string;
	initialType: ColumnFieldType;
	initialFormula: string;
	validateName?: (name: string) => string | null;
	onSubmit: (result: ColumnEditorResult) => void;
	onCancel: () => void;
}

class ColumnEditorModal extends Modal {
	private readonly options: ColumnEditorModalOptions;
	private type: ColumnFieldType;
	private nameValue: string;
	private formulaSetting!: Setting;
	private formulaInput!: HTMLTextAreaElement;
	private nameInput!: HTMLInputElement;
	private errorEl!: HTMLElement;
	private submitted = false;

	constructor(app: App, options: ColumnEditorModalOptions) {
		super(app);
		this.options = options;
		this.type = options.initialType;
		this.nameValue = options.columnName;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-column-editor-modal');
		this.titleEl.setText(`编辑列：${this.options.columnName}`);

		const nameSetting = new Setting(contentEl);
		nameSetting.setName('列名称');
		nameSetting.addText((text) => {
			text.setPlaceholder('请输入列名称');
			text.setValue(this.nameValue);
			this.nameInput = text.inputEl;
			text.onChange((value) => {
				this.nameValue = value;
			});
		});

		const typeSetting = new Setting(contentEl);
		typeSetting.setName('列类型');
		typeSetting.addDropdown((dropdown) => {
			dropdown.addOption('text', '文本');
			dropdown.addOption('formula', '公式');
			dropdown.setValue(this.type);
			dropdown.onChange((value) => {
				this.type = value === 'formula' ? 'formula' : 'text';
				this.updateFormulaVisibility();
			});
		});

		this.formulaSetting = new Setting(contentEl);
		this.formulaSetting.setName('公式');
		this.formulaSetting.setDesc('使用 {字段} 引用列，仅支持 + - * / 与括号。');
		this.formulaSetting.controlEl.empty();
		const textarea = document.createElement('textarea');
		textarea.className = 'tlb-column-formula-input';
		textarea.rows = 4;
		textarea.placeholder = '{points} + {cost}';
		textarea.value = this.options.initialFormula;
		this.formulaSetting.controlEl.appendChild(textarea);
		this.formulaInput = textarea;

		this.errorEl = contentEl.createDiv({ cls: 'tlb-column-editor-error' });
		this.errorEl.style.display = 'none';
		this.errorEl.style.color = 'var(--text-error, #ff4d4f)';

		const actionSetting = new Setting(contentEl);
		actionSetting.addButton((button) => {
			button.setButtonText('保存').setCta().onClick(() => {
				this.submit();
			});
		});
		actionSetting.addButton((button) => {
			button.setButtonText('取消').onClick(() => {
				this.close();
			});
		});

		this.updateFormulaVisibility();
	}

	onClose(): void {
		if (!this.submitted) {
			this.options.onCancel();
		}
	}

	private updateFormulaVisibility(): void {
		const hidden = this.type !== 'formula';
		if (this.formulaSetting) {
			const el = this.formulaSetting.settingEl as HTMLElement;
			el.style.display = hidden ? 'none' : '';
		}
		if (this.formulaInput) {
			this.formulaInput.disabled = hidden;
		}
	}

	private setError(message: string | null): void {
		if (!this.errorEl) {
			return;
		}
		if (message && message.trim().length > 0) {
			this.errorEl.style.display = '';
			this.errorEl.setText(message);
		} else {
			this.errorEl.style.display = 'none';
			this.errorEl.empty();
		}
	}

	private submit(): void {
		this.setError(null);
		const trimmedName = this.nameValue.trim();
		if (trimmedName.length === 0) {
			this.setError('列名称不能为空');
			this.nameInput?.focus();
			return;
		}
		if (this.options.validateName) {
			const validationMessage = this.options.validateName(trimmedName);
			if (validationMessage) {
				this.setError(validationMessage);
				this.nameInput?.focus();
				return;
			}
		}
		if (this.type === 'formula') {
			const formula = this.formulaInput.value.trim();
			if (formula.length === 0) {
				this.setError('公式不能为空');
				this.formulaInput.focus();
				return;
			}
			try {
				compileFormula(formula);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.setError(`公式错误：${message}`);
				this.formulaInput.focus();
				return;
			}
			this.options.onSubmit({ name: trimmedName, type: 'formula', formula });
			this.submitted = true;
			this.close();
			return;
		}

		this.options.onSubmit({ name: trimmedName, type: 'text', formula: '' });
		this.submitted = true;
		this.close();
	}
}

