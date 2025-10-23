import { App, ItemView, WorkspaceLeaf, TFile, Notice, setIcon } from "obsidian";
import { GridAdapter, ColumnDef, RowData, CellEditEvent, ROW_ID_FIELD, SortModelEntry, HeaderEditEvent } from "./grid/GridAdapter";
import { TaskStatus } from "./renderers/StatusCellRenderer";
import { getPluginContext } from "./pluginContext";
import { clampColumnWidth } from "./grid/columnSizing";
import { getCurrentLocalDateTime } from "./utils/datetime";
import { debugLog } from "./utils/logger";
import type { ColumnState } from "ag-grid-community";
import type { FileFilterViewState, FilterRule, FilterCondition, FilterOperator, SortRule } from "./types/filterView";
import { ColumnLayoutStore } from "./table-view/ColumnLayoutStore";
import { GridController } from "./table-view/GridController";
import { MarkdownBlockParser, ColumnConfig, H2Block } from "./table-view/MarkdownBlockParser";
import { SchemaBuilder, Schema } from "./table-view/SchemaBuilder";
import { FilterStateStore } from "./table-view/filter/FilterStateStore";
import { FilterViewBar } from "./table-view/filter/FilterViewBar";
import { FilterViewController } from "./table-view/filter/FilterViewController";
import { TableDataStore } from "./table-view/TableDataStore";
import { TableConfigManager } from "./table-view/TableConfigManager";
import { ColumnInteractionController } from "./table-view/ColumnInteractionController";
import { RowInteractionController } from "./table-view/RowInteractionController";
import { GridInteractionController } from "./table-view/GridInteractionController";
import { FocusManager } from "./table-view/FocusManager";
import { GridLayoutController } from "./table-view/GridLayoutController";
import { FilterViewOrchestrator } from "./table-view/FilterViewOrchestrator";
import { GlobalQuickFilterController } from "./table-view/GlobalQuickFilterController";
import { TablePersistenceService } from "./table-view/TablePersistenceService";

const LOG_PREFIX = "[TileLineBase]";
const FORMULA_ROW_LIMIT = 5000;
const FORMULA_ERROR_VALUE = '#ERR';
const FORMULA_TOOLTIP_PREFIX = '__tlbFormulaTooltip__';

export const TABLE_VIEW_TYPE = "tile-line-base-table";

interface TableViewState extends Record<string, unknown> {
	filePath: string;
}

export class TableView extends ItemView {
	file: TFile | null = null;
        private blocks: H2Block[] = [];
        private schema: Schema | null = null;
        private schemaDirty: boolean = false;
        private sparseCleanupRequired: boolean = false;
        private hiddenSortableFields: Set<string> = new Set();
        private gridAdapter: GridAdapter | null = null;
        private gridController = new GridController();
        private columnLayoutStore = new ColumnLayoutStore(null);
        private markdownParser = new MarkdownBlockParser();
        private schemaBuilder = new SchemaBuilder();
        private dataStore = new TableDataStore({
                rowLimit: FORMULA_ROW_LIMIT,
                errorValue: FORMULA_ERROR_VALUE,
                tooltipPrefix: FORMULA_TOOLTIP_PREFIX
        });
        private configManager: TableConfigManager;
        private persistenceService: TablePersistenceService;
        private columnInteractionController: ColumnInteractionController;
        private rowInteractionController: RowInteractionController;
        private gridInteractionController: GridInteractionController;
        private filterOrchestrator: FilterViewOrchestrator;
        private gridLayoutController: GridLayoutController;
        private focusManager: FocusManager;
        private globalQuickFilterController: GlobalQuickFilterController;

        // 事件监听器引用（用于清理）
	private tableContainer: HTMLElement | null = null;
	private filterViewBar: FilterViewBar | null = null;
	private filterViewController: FilterViewController;
	private filterStateStore = new FilterStateStore(null);
        private filterViewState: FileFilterViewState = this.filterStateStore.getState();
        private initialColumnState: ColumnState[] | null = null;


	constructor(leaf: WorkspaceLeaf) {
		debugLog('=== TableView 构造函数开始 ===');
		debugLog('leaf:', leaf);
		super(leaf);
		this.configManager = new TableConfigManager(this.app);
		this.persistenceService = new TablePersistenceService({
			app: this.app,
			dataStore: this.dataStore,
			columnLayoutStore: this.columnLayoutStore,
			configManager: this.configManager,
			filterStateStore: this.filterStateStore,
			getFile: () => this.file,
			getFilterViewState: () => this.filterViewState
		});
		this.columnInteractionController = new ColumnInteractionController({
			app: this.app,
			dataStore: this.dataStore,
			columnLayoutStore: this.columnLayoutStore,
			getSchema: () => this.schema,
			renameColumnInFilterViews: (oldName, newName) => {
				this.renameColumnInFilterViews(oldName, newName);
			},
			removeColumnFromFilterViews: (name) => {
				this.removeColumnFromFilterViews(name);
			},
			persistColumnStructureChange: (options) => {
				this.persistColumnStructureChange(options);
			}
		});
		this.rowInteractionController = new RowInteractionController({
			dataStore: this.dataStore,
			getSchema: () => this.schema,
			getFocusedField: () => this.gridAdapter?.getFocusedCell?.()?.field ?? null,
			refreshGridData: () => {
				this.refreshGridData();
			},
			focusRow: (rowIndex, field) => {
				this.focusRow(rowIndex, field ?? undefined);
			},
			scheduleSave: () => {
				this.persistenceService.scheduleSave();
			},
			getActiveFilterPrefills: () => this.getActiveFilterPrefills()
		});
		this.globalQuickFilterController = new GlobalQuickFilterController({
			getGridAdapter: () => this.gridAdapter
		});
		this.filterOrchestrator = new FilterViewOrchestrator({
			dataStore: this.dataStore,
			getFilterViewState: () => this.filterViewState,
			getGridAdapter: () => this.gridAdapter,
			getSchemaColumns: () => this.schema?.columnNames ?? null,
			reapplyGlobalQuickFilter: () => this.reapplyGlobalQuickFilter(),
			emitFormulaLimitNotice: (limit) => {
				new Notice(`公式列已停用（行数超过 ${limit}）`);
			}
		});
		this.gridInteractionController = new GridInteractionController({
			columnInteraction: this.columnInteractionController,
			rowInteraction: this.rowInteractionController,
			dataStore: this.dataStore,
			getGridAdapter: () => this.gridAdapter
		});
		this.gridLayoutController = new GridLayoutController(this.app, this.gridController);
		this.focusManager = new FocusManager({
			getSchema: () => this.schema,
			getBlockCount: () => this.blocks.length,
			getVisibleRows: () => this.filterOrchestrator.getVisibleRows(),
			getGridAdapter: () => this.gridAdapter
		});
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
                const changed = this.dataStore.reorderColumns(orderedFields);
                if (!changed) {
                        return;
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

	private getFormulaTooltipField(columnName: string): string {
		return `${FORMULA_TOOLTIP_PREFIX}${columnName}`;
	}


	/**
	 * 调度保存（500ms 防抖）
	 */
	private scheduleSave(): void {
		this.persistenceService.scheduleSave();
	}

	/**
	 * 保存到文件
	 */
        private async saveToFile(): Promise<void> {
                if (!this.file) return;

                try {
                        const markdown = this.dataStore.blocksToMarkdown().trimEnd();
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
                this.configManager.reset();
                this.filterStateStore.setFilePath(this.file.path);
                this.filterStateStore.resetState();
                // 读取文件内容
                const content = await this.app.vault.read(this.file);

		// 尝试加载配置块（带缓存）
		const configBlock = await this.persistenceService.loadConfig();

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
                this.dataStore.initialise(schemaResult, columnConfigs ?? null);
                this.schema = this.dataStore.getSchema();
                this.hiddenSortableFields = this.dataStore.getHiddenSortableFields();
                const dirtyFlags = this.dataStore.consumeDirtyFlags();
                this.schemaDirty = dirtyFlags.schemaDirty;
                this.sparseCleanupRequired = dirtyFlags.sparseCleanupRequired;

                if (!this.schema) {
                        container.createDiv({ text: "无法提取表格结构" });
                        return;
                }
                if (this.schemaDirty || this.sparseCleanupRequired) {
                        this.scheduleSave();
                        this.schemaDirty = false;
                        this.sparseCleanupRequired = false;
                }

                // 提取数据
		// 准备列定义（添加序号列）
		// 如果没有从配置块加载 filterViewState，则从插件设置加载
		if (!this.filterViewState || this.filterViewState.views.length === 0) {
			this.filterStateStore.loadFromSettings();
			this.filterViewState = this.filterStateStore.getState();
		}
		this.filterOrchestrator.refresh();
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

                                const isFormulaColumn = this.dataStore.isFormulaColumn(name);
                                if (isFormulaColumn) {
                                        baseColDef.editable = false;
                                        (baseColDef as any).tooltipField = this.dataStore.getFormulaTooltipField(name);
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
			const result = this.gridController.mount(
				tableContainer,
				columns,
				this.filterOrchestrator.getVisibleRows(),
				{
				onStatusChange: (rowId: string, newStatus: TaskStatus) => {
					this.onStatusChange(rowId, newStatus);
				},
				onColumnResize: (field: string, width: number) => {
					this.handleColumnResize(field, width);
				},
				onCopyH2Section: (rowIndex: number) => {
					void this.gridInteractionController.copySection(rowIndex);
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
					this.columnInteractionController.handleColumnHeaderContextMenu(field, event);
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
			this.gridLayoutController.attach(result.container);
			this.applyActiveFilterView();
			this.gridInteractionController.attach(result.container);
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
		this.gridInteractionController.detach();
		this.gridLayoutController.detach();
		this.focusManager.clearPendingFocus('cleanup');
	}

	/**
	 * 设置容器尺寸监听器（包括窗口 resize）
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

                const blockIndex = this.dataStore.getBlockIndexFromRow(rowData);
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
                const renamed = this.dataStore.renameColumn(oldName, trimmed);
                if (!renamed) {
                        new Notice(`重命名列失败：${trimmed}`);
                        return;
                }
                this.columnLayoutStore.rename(oldName, trimmed);
                this.renameColumnInFilterViews(oldName, trimmed);
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
		this.rowInteractionController.addRow(beforeRowIndex, options);
	}

	/**
	 * 聚焦并选中指定行，保持视图位置
	 */
	private focusRow(
		rowIndex: number,
		field?: string,
		options?: { retryCount?: number; retryDelay?: number }
	): void {
		this.focusManager.focusRow(rowIndex, field ?? null, options);
	}

	private clearPendingFocus(reason?: string): void {
		this.focusManager.clearPendingFocus(reason);
	}

	private handleGridModelUpdated(): void {
		this.focusManager.handleGridModelUpdated();
	}

	/**
	 * 删除指定行（Key:Value 格式）
	 * @param rowIndex 数据行索引
	 */
	private deleteRow(rowIndex: number): void {
		this.rowInteractionController.deleteRow(rowIndex);
	}
	/**
	 * 批量删除指定的多行
	 * @param rowIndexes 要删除的行索引数组（块索引）
	 */
	private deleteRows(rowIndexes: number[]): void {
		this.rowInteractionController.deleteRows(rowIndexes);
	}
	/**
	 * 批量复制指定的多行
	 * @param rowIndexes 要复制的行索引数组（块索引）
	 */
	private duplicateRows(rowIndexes: number[]): void {
		this.rowInteractionController.duplicateRows(rowIndexes);
	}
	/**
	 * 复制指定行（Key:Value 格式）
	 * @param rowIndex 数据行索引
	 */
	private duplicateRow(rowIndex: number): void {
		this.rowInteractionController.duplicateRow(rowIndex);
	}

	private persistColumnStructureChange(options?: { notice?: string }): void {
		if (!this.schema) {
			return;
		}
		this.schema = this.dataStore.getSchema();
		this.hiddenSortableFields = this.dataStore.getHiddenSortableFields();
		this.refreshGridData();
		if (options?.notice) {
			new Notice(options.notice);
		}
		this.persistenceService.cancelScheduledSave();
		void (async () => {
			try {
				await this.persistenceService.save();
				await this.render();
			} catch (error) {
				console.error(`${LOG_PREFIX} Failed to persist column change`, error);
			}
		})();
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
	this.globalQuickFilterController.cleanup();

	this.filterViewBar = new FilterViewBar({
		container,
		renderQuickFilter: (searchContainer) => this.globalQuickFilterController.render(searchContainer),
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

private reapplyGlobalQuickFilter(): void {
	this.globalQuickFilterController.reapply();
}

private syncFilterViewState(): void {
	this.filterViewState = this.filterStateStore.getState();
}

private refreshGridData(): void {
		this.filterOrchestrator.refresh();
	}

	private applyActiveFilterView(): void {
		this.filterOrchestrator.applyActiveView();
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
	/**
	 * 加载配置（带缓存机制）
	 */
        private async loadConfig(): Promise<Record<string, any> | null> {
                if (!this.file) return null;
                return this.configManager.load(this.file);
        }

	/**
	 * 保存配置块（二级标题 + 配置块）
	 */
        private async saveConfigBlock(): Promise<void> {
                if (!this.file) return;

                const columnConfigs = this.schema?.columnConfigs
                        ? this.schema.columnConfigs
                                .filter((config) => this.dataStore.hasColumnConfigContent(config))
                                .map((config) => this.dataStore.serializeColumnConfig(config))
                        : [];
                const widthPrefs = this.columnLayoutStore.exportPreferences();

                await this.configManager.save(this.file, {
                        filterViews: this.filterViewState,
                        columnWidths: widthPrefs,
                        columnConfigs,
                        viewPreference: 'table'
                });
        }

			async onClose(): Promise<void> {
		this.globalQuickFilterController.cleanup();
		if (this.filterViewBar) {
			this.filterViewBar.destroy();
			this.filterViewBar = null;
		}

		this.cleanupEventListeners();
		this.gridInteractionController.hideContextMenu();
		this.clearPendingFocus('view-close');
		this.gridController.destroy();
		this.gridAdapter = null;
		this.tableContainer = null;
		this.persistenceService.cancelScheduledSave();
		this.persistenceService.dispose();
	}

}


