import { ItemView, WorkspaceLeaf, TFile, Menu } from "obsidian";
import type { ColumnState } from "ag-grid-community";
import type { GridAdapter } from "./grid/GridAdapter";
import { getLogger } from "./utils/logger";
import { ColumnLayoutStore } from "./table-view/ColumnLayoutStore";
import { GridController } from "./table-view/GridController";
import { MarkdownBlockParser, H2Block } from "./table-view/MarkdownBlockParser";
import { SchemaBuilder, Schema } from "./table-view/SchemaBuilder";
import { FilterStateStore } from "./table-view/filter/FilterStateStore";
import type { FilterViewBar } from "./table-view/filter/FilterViewBar";
import type { FilterViewController } from "./table-view/filter/FilterViewController";
import { TagGroupStore } from "./table-view/filter/tag-group/TagGroupStore";
import { TagGroupController } from "./table-view/filter/tag-group/TagGroupController";
import type { FileFilterViewState, FilterRule } from "./types/filterView";
import type { FileTagGroupState } from "./types/tagGroup";
import { TableDataStore } from "./table-view/TableDataStore";
import type { TableConfigManager } from "./table-view/TableConfigManager";
import type { ColumnInteractionController } from "./table-view/ColumnInteractionController";
import type { RowInteractionController } from "./table-view/RowInteractionController";
import type { RowMigrationController } from "./table-view/RowMigrationController";
import type { GridInteractionController } from "./table-view/GridInteractionController";
import type { FocusManager } from "./table-view/FocusManager";
import type { GridLayoutController } from "./table-view/GridLayoutController";
import type { FilterViewOrchestrator } from "./table-view/FilterViewOrchestrator";
import type { GlobalQuickFilterController } from "./table-view/GlobalQuickFilterController";
import type { TablePersistenceService } from "./table-view/TablePersistenceService";
import { initializeTableView } from "./table-view/TableViewSetup";
import { renderTableView } from "./table-view/TableViewRenderer";
import { handleOnClose } from "./table-view/TableViewInteractions";
import { t } from "./i18n";
import { CopyTemplateController } from "./table-view/CopyTemplateController";
import { TableHistoryManager } from "./table-view/TableHistoryManager";
import { getPluginContext } from "./pluginContext";
import type { ParagraphPromotionController } from "./table-view/paragraph/ParagraphPromotionController";
import { TableRefreshCoordinator } from "./table-view/TableRefreshCoordinator";
import { TableCreationController } from "./table-view/TableCreationController";
import type { KanbanViewController } from "./table-view/kanban/KanbanViewController";
import { KanbanViewModeManager } from "./table-view/kanban/KanbanViewModeManager";
import type { KanbanToolbar } from "./table-view/kanban/KanbanToolbar";
import { KanbanBoardStore } from "./table-view/kanban/KanbanBoardStore";
import type { KanbanBoardController } from "./table-view/kanban/KanbanBoardController";
import type { KanbanBoardState, KanbanCardContentConfig, KanbanHeightMode, KanbanSortDirection } from "./types/kanban";
import { DEFAULT_KANBAN_FONT_SCALE, DEFAULT_KANBAN_HEIGHT_MODE, DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT, DEFAULT_KANBAN_SORT_DIRECTION } from "./types/kanban";
import { sanitizeKanbanHeightMode } from "./table-view/kanban/kanbanHeight";
import { DEFAULT_KANBAN_LANE_WIDTH } from "./table-view/kanban/kanbanWidth";

export const TABLE_VIEW_TYPE = "tile-line-base-table";
const logger = getLogger("view:table");

export interface TableViewState extends Record<string, unknown> {
	filePath: string;
}

export class TableView extends ItemView {
	public file: TFile | null = null;
	public blocks: H2Block[] = [];
	public schema: Schema | null = null;
	public schemaDirty = false;
	public sparseCleanupRequired = false;
	public hiddenSortableFields: Set<string> = new Set();
	public copyTemplate: string | null = null;
	public gridAdapter: GridAdapter | null = null;
	public gridController = new GridController();
	public columnLayoutStore = new ColumnLayoutStore(null);
	public markdownParser = new MarkdownBlockParser();
	public schemaBuilder = new SchemaBuilder();
	public dataStore = new TableDataStore({ rowLimit: 5000, errorValue: "#ERR", tooltipPrefix: "__tlbFormulaTooltip__" });
	public configManager!: TableConfigManager;
	public persistenceService!: TablePersistenceService;
	public columnInteractionController!: ColumnInteractionController;
	public rowInteractionController!: RowInteractionController;
	public rowMigrationController!: RowMigrationController;
	public gridInteractionController!: GridInteractionController;
	public filterOrchestrator!: FilterViewOrchestrator;
	public gridLayoutController!: GridLayoutController;
	public focusManager!: FocusManager;
	public globalQuickFilterController!: GlobalQuickFilterController;
	public copyTemplateController!: CopyTemplateController;
	public paragraphPromotionController!: ParagraphPromotionController;
	public tableCreationController!: TableCreationController;
	public historyManager = new TableHistoryManager(this);
	public refreshCoordinator!: TableRefreshCoordinator;
	public tableContainer: HTMLElement | null = null;
	public filterViewBar: FilterViewBar | null = null;
	public filterViewController!: FilterViewController;
	public filterStateStore = new FilterStateStore(null);
	public filterViewState: FileFilterViewState = this.filterStateStore.getState();
	public tagGroupStore = new TagGroupStore(null);
	public tagGroupController!: TagGroupController;
	public tagGroupState: FileTagGroupState = this.tagGroupStore.getState();
	public initialColumnState: ColumnState[] | null = null;
	private markdownToggleButton: HTMLElement | null = null;
	public activeViewMode: 'table' | 'kanban' = 'table';
	public kanbanController: KanbanViewController | null = null;
	public kanbanLaneField: string | null = null;
	public kanbanLaneWidth = DEFAULT_KANBAN_LANE_WIDTH;
	public kanbanFontScale = DEFAULT_KANBAN_FONT_SCALE;
	public kanbanSortField: string | null = null;
	public kanbanSortDirection: KanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
	public kanbanHeightMode: KanbanHeightMode = DEFAULT_KANBAN_HEIGHT_MODE;
	public kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
	public kanbanCardContentConfig: KanbanCardContentConfig | null = null;
	public kanbanPreferencesLoaded = false;
	public kanbanToolbar: KanbanToolbar | null = null;
	public activeKanbanBoardId: string | null = null;
	public activeKanbanBoardFilter: FilterRule | null = null;
	public kanbanBoardStore = new KanbanBoardStore(null);
	public kanbanBoardController!: KanbanBoardController;
	public kanbanBoardsLoaded = false;
	public pendingKanbanBoardState: KanbanBoardState | null = null;
	private kanbanManager!: KanbanViewModeManager;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		initializeTableView(this);
		this.kanbanManager = new KanbanViewModeManager(this);
	}

	getViewType(): string {
		return TABLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? t("tableView.displayName");
	}

	public refreshDisplayText(): void {
		const displayText = this.getDisplayText();
		const leafWithTab = this.leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement | null };
		this.setElementText(leafWithTab?.tabHeaderInnerTitleEl ?? null, displayText);

		const leafEl = this.containerEl.closest('.workspace-leaf');
		const headerTitleEl = (leafEl?.querySelector('.view-header-title') as HTMLElement | null) ?? null;
		this.setElementText(headerTitleEl, displayText);
	}

	private setElementText(element: HTMLElement | null | undefined, text: string): void {
		if (!element) {
			return;
		}
		const setText = (element as any).setText;
		if (typeof setText === 'function') {
			setText.call(element, text);
			return;
		}
		element.textContent = text;
	}

	async setState(state: TableViewState, _result: unknown): Promise<void> {
		logger.debug("setState", state);
		try {
			const file = this.app.vault.getAbstractFileByPath(state.filePath);
			if (file instanceof TFile) {
				this.file = file;
				this.refreshCoordinator.setTrackedFile(file);
				this.kanbanBoardsLoaded = false;
				await this.render();
			} else {
				this.file = null;
				this.refreshCoordinator.setTrackedFile(null);
			}
		} catch (error) {
			logger.error("setState failed", error);
			throw error;
		} finally {
			this.refreshDisplayText();
		}
	}

	getState(): TableViewState {
		return { filePath: this.file?.path ?? "" };
	}

	async render(): Promise<void> {
		if (this.kanbanBoardController) {
			this.kanbanBoardController.ensureInitialized();
			this.kanbanBoardsLoaded = true;
		}
		const snapshot = this.refreshCoordinator ? this.refreshCoordinator.captureViewSnapshot() : null;
		await renderTableView(this);

		const rerenderMode = await this.kanbanManager.handleAfterRender();
		if (rerenderMode) {
			await renderTableView(this);
			if (rerenderMode === 'kanban') {
				await this.kanbanManager.handleAfterRender();
			}
		}

		if (this.refreshCoordinator) {
			await this.refreshCoordinator.finalizeRender(snapshot);
		}
		this.kanbanManager.updateToggleButton();
		this.refreshDisplayText();
	}

	async onOpen(): Promise<void> {
		this.ensureMarkdownToggle();
		this.kanbanManager.ensureToggle();
		this.kanbanManager.updateToggleButton();
	}

	async onClose(): Promise<void> {
		if (this.markdownToggleButton) {
			this.markdownToggleButton.remove();
			this.markdownToggleButton = null;
		}
		this.kanbanManager.detachToggle();
		if (this.kanbanController) {
			this.kanbanController.destroy();
			this.kanbanController = null;
		}
		if (this.kanbanToolbar) {
			this.kanbanToolbar.destroy();
			this.kanbanToolbar = null;
		}
		this.activeKanbanBoardId = null;
		this.kanbanBoardStore.reset();
		if (this.kanbanBoardController) {
			this.kanbanBoardController.reset();
		}
		this.kanbanBoardsLoaded = false;
		await handleOnClose(this);
		if (this.refreshCoordinator) {
			this.refreshCoordinator.dispose();
		}
	}

	onMoreOptions(menu: Menu): void {
		const plugin = getPluginContext();
		if (!plugin) {
			return;
		}
		const isKanban = this.activeViewMode === "kanban";
		menu.addItem((item) => {
			item
				.setTitle(isKanban ? t("kanbanView.actions.switchToTable") : t("kanbanView.actions.switchToKanban"))
				.setIcon(isKanban ? "table" : "layout-kanban")
				.onClick(() => {
					void this.setActiveViewMode(isKanban ? "table" : "kanban");
				});
		});
		menu.addItem((item) => {
			item
				.setTitle(t("commands.openHelpDocument"))
				.setIcon("info")
				.onClick(() => {
					void plugin.openHelpDocument();
				});
		});
	}

	private ensureMarkdownToggle(): void {
		if (this.markdownToggleButton) {
			return;
		}

		const label = t("viewControls.openMarkdownView");
		const button = this.addAction("pencil", label, async (evt) => {
			const plugin = getPluginContext();
			if (!plugin) {
				logger.warn("No plugin context when toggling to markdown view");
				return;
			}
			try {
				await plugin.toggleLeafView(this.leaf);
			} catch (error) {
				logger.error("Failed to toggle back to markdown view", error);
			}
			evt?.preventDefault();
			evt?.stopPropagation();
		});
		button.setAttribute("data-tlb-action", "open-markdown-view");
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
		this.markdownToggleButton = button;
	}


	public setKanbanHeightMode(mode: KanbanHeightMode): void {
		const normalized = sanitizeKanbanHeightMode(mode);
		if (this.kanbanHeightMode === normalized) {
			return;
		}
		this.kanbanHeightMode = normalized;
		if (this.kanbanController) {
			this.kanbanController.setHeightMode(normalized);
		}
		this.persistenceService?.scheduleSave();
	}

	public async setActiveViewMode(mode: 'table' | 'kanban'): Promise<void> {
		await this.kanbanManager.setActiveViewMode(mode);
	}

}
