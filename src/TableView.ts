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
import type { FileFilterViewState } from "./types/filterView";
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
	public kanbanSortField: string | null = "看板排序";
	public kanbanPreferencesLoaded = false;
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

	async setState(state: TableViewState, _result: unknown): Promise<void> {
		logger.debug("setState", state);
		try {
			const file = this.app.vault.getAbstractFileByPath(state.filePath);
			if (file instanceof TFile) {
				this.file = file;
				this.refreshCoordinator.setTrackedFile(file);
				await this.render();
			} else {
				this.refreshCoordinator.setTrackedFile(null);
			}
		} catch (error) {
			logger.error("setState failed", error);
			throw error;
		}
	}

	getState(): TableViewState {
		return { filePath: this.file?.path ?? "" };
	}

	async render(): Promise<void> {
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


	public async setActiveViewMode(mode: 'table' | 'kanban'): Promise<void> {
		await this.kanbanManager.setActiveViewMode(mode);
	}

}
