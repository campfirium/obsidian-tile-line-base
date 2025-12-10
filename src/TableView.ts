import { ItemView, WorkspaceLeaf, TFile, Menu } from "obsidian";
import type { ColumnState } from "ag-grid-community";
import type { GridAdapter } from "./grid/GridAdapter";
import { getLogger } from "./utils/logger";
import { ColumnLayoutStore } from "./table-view/ColumnLayoutStore";
import { GridController } from "./table-view/GridController";
import { MarkdownBlockParser, H2Block } from "./table-view/MarkdownBlockParser";
import { SchemaBuilder, Schema } from "./table-view/SchemaBuilder";
import { FilterStateStore } from "./table-view/filter/FilterStateStore";
import { GlobalQuickFilterManager } from "./table-view/filter/GlobalQuickFilterManager";
import type { FilterViewBar } from "./table-view/filter/FilterViewBar";
import type { FilterViewController } from "./table-view/filter/FilterViewController";
import { GalleryFilterBar } from "./table-view/gallery/GalleryFilterBar";
import { TagGroupStore } from "./table-view/filter/tag-group/TagGroupStore";
import { TagGroupController } from "./table-view/filter/tag-group/TagGroupController";
import type { FileFilterViewState, FilterRule } from "./types/filterView";
import type { FileTagGroupState } from "./types/tagGroup";
import { TableDataStore } from "./table-view/TableDataStore";
import type { TableConfigManager } from "./table-view/TableConfigManager";
import { RenderScheduler } from "./table-view/RenderScheduler";
import type { ColumnInteractionController } from "./table-view/ColumnInteractionController";
import type { RowInteractionController } from "./table-view/RowInteractionController";
import type { RowMigrationController } from "./table-view/RowMigrationController";
import type { GridInteractionController } from "./table-view/GridInteractionController";
import type { FocusManager } from "./table-view/FocusManager";
import type { GridLayoutController } from "./table-view/GridLayoutController";
import type { FilterViewOrchestrator } from "./table-view/FilterViewOrchestrator";
import type { GalleryFilterOrchestrator } from "./table-view/gallery/GalleryFilterOrchestrator";
import type { GlobalQuickFilterController } from "./table-view/GlobalQuickFilterController";
import type { TablePersistenceService } from "./table-view/TablePersistenceService";
import { initializeTableView } from "./table-view/TableViewSetup";
import { renderTableView } from "./table-view/TableViewRenderer";
import { handleOnClose } from "./table-view/TableViewInteractions";
import { ensureMarkdownToggle } from "./table-view/MarkdownToggle";
import { CopyTemplateController } from "./table-view/CopyTemplateController";
import { TableHistoryManager } from "./table-view/TableHistoryManager";
import type { ParagraphPromotionController } from "./table-view/paragraph/ParagraphPromotionController";
import { TableRefreshCoordinator } from "./table-view/TableRefreshCoordinator";
import { TableCreationController } from "./table-view/TableCreationController";
import { TableFileDuplicationController } from "./table-view/TableFileDuplicationController";
import type { GalleryViewController } from "./table-view/gallery/GalleryViewController";
import { GalleryViewStore } from "./table-view/gallery/GalleryViewStore";
import type { KanbanViewController } from "./table-view/kanban/KanbanViewController";
import { ViewModeManager } from "./table-view/ViewModeManager";
import type { KanbanToolbar } from "./table-view/kanban/KanbanToolbar";
import type { GalleryToolbar } from "./table-view/gallery/GalleryToolbar";
import { KanbanBoardStore } from "./table-view/kanban/KanbanBoardStore";
import type { KanbanBoardController } from "./table-view/kanban/KanbanBoardController";
import type { KanbanBoardState, KanbanCardContentConfig, KanbanHeightMode, KanbanSortDirection } from "./types/kanban";
import { DEFAULT_KANBAN_FONT_SCALE, DEFAULT_KANBAN_HEIGHT_MODE, DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT, DEFAULT_KANBAN_SORT_DIRECTION, DEFAULT_KANBAN_SORT_FIELD } from "./types/kanban";
import { sanitizeKanbanHeightMode } from "./table-view/kanban/kanbanHeight";
import { DEFAULT_KANBAN_LANE_WIDTH } from "./table-view/kanban/kanbanWidth";
import { buildTableViewTabTitle } from "./utils/viewTitle";
import { ConversionSessionManager } from "./table-view/ConversionSessionManager";
import { refreshTableViewDisplayText } from "./table-view/viewDisplayText";
import type { SlideViewConfig } from "./types/slide";
import { normalizeSlideViewConfig } from "./types/slide";
import type { SlideViewInstance } from "./table-view/slide/renderSlideView";
import { populateMoreOptionsMenu } from "./table-view/TableViewMenu";
import { RowOrderController } from "./table-view/row-sort/RowOrderController";
import type { MagicMigrationController } from "./table-view/MagicMigrationController";
export const TABLE_VIEW_TYPE = "tile-line-base-table";
const logger = getLogger("view:table");
export interface TableViewState extends Record<string, unknown> {
	filePath: string;
}
export class TableView extends ItemView {
	public file: TFile | null = null; public blocks: H2Block[] = [];
	public schema: Schema | null = null; public schemaDirty = false;
	public sparseCleanupRequired = false; public hiddenSortableFields: Set<string> = new Set();
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
	public rowOrderController!: RowOrderController;
	public gridInteractionController!: GridInteractionController; public filterOrchestrator!: FilterViewOrchestrator; public galleryFilterOrchestrator!: GalleryFilterOrchestrator;
	public gridLayoutController!: GridLayoutController; public focusManager!: FocusManager; public globalQuickFilterController!: GlobalQuickFilterController; public galleryQuickFilterController!: GlobalQuickFilterController;
	public copyTemplateController!: CopyTemplateController;
	public paragraphPromotionController!: ParagraphPromotionController;
	public tableCreationController!: TableCreationController;
	public fileDuplicationController!: TableFileDuplicationController;
	public magicMigrationController!: MagicMigrationController;
	public historyManager = new TableHistoryManager(this);
	public refreshCoordinator!: TableRefreshCoordinator;
	public tableContainer: HTMLElement | null = null; public filterViewBar: FilterViewBar | null = null; public galleryFilterBar: GalleryFilterBar | null = null;
	private readonly conversionSession = new ConversionSessionManager(this);
	public filterViewController!: FilterViewController; public galleryFilterViewController!: FilterViewController;
	public filterStateStore = new FilterStateStore(null); public filterViewState: FileFilterViewState = this.filterStateStore.getState();
	public galleryFilterStateStore = new FilterStateStore(null, 'gallery'); public galleryFilterViewState: FileFilterViewState = this.galleryFilterStateStore.getState();
	public globalQuickFilterManager = new GlobalQuickFilterManager(); public galleryQuickFilterManager = new GlobalQuickFilterManager();
	public tagGroupStore = new TagGroupStore(null); public tagGroupController!: TagGroupController; public tagGroupState: FileTagGroupState = this.tagGroupStore.getState();
	public galleryTagGroupStore = new TagGroupStore(null, 'gallery'); public galleryTagGroupController!: TagGroupController; public galleryTagGroupState: FileTagGroupState = this.galleryTagGroupStore.getState();
	public initialColumnState: ColumnState[] | null = null; public markdownToggleButton: HTMLElement | null = null;
	public activeViewMode: 'table' | 'kanban' | 'slide' | 'gallery' = 'table';
	public kanbanController: KanbanViewController | null = null;
	public kanbanLaneField: string | null = null; public kanbanLaneWidth = DEFAULT_KANBAN_LANE_WIDTH;
	public kanbanFontScale = DEFAULT_KANBAN_FONT_SCALE; public kanbanSortField: string | null = DEFAULT_KANBAN_SORT_FIELD;
	public kanbanSortDirection: KanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
	public kanbanHeightMode: KanbanHeightMode = DEFAULT_KANBAN_HEIGHT_MODE; public kanbanMultiRowEnabled = true;
	public kanbanInitialVisibleCount = DEFAULT_KANBAN_INITIAL_VISIBLE_COUNT;
	public kanbanCardContentConfig: KanbanCardContentConfig | null = null;
	public kanbanLanePresets: string[] = []; public kanbanLaneOrder: string[] = [];
	public kanbanPreferencesLoaded = false; public kanbanToolbar: KanbanToolbar | null = null;
	public activeKanbanBoardId: string | null = null; public activeKanbanBoardFilter: FilterRule | null = null;
	public kanbanBoardStore = new KanbanBoardStore(null); public kanbanBoardController!: KanbanBoardController;
	public kanbanBoardsLoaded = false; public pendingKanbanBoardState: KanbanBoardState | null = null;
	public slideConfig: SlideViewConfig = normalizeSlideViewConfig(null); public slideController: SlideViewInstance | null = null;
	public slidePreferencesLoaded = false; public shouldAutoFillSlideDefaults = false; public slideTemplateTouched = false;
	public galleryConfig: SlideViewConfig = normalizeSlideViewConfig(null); public galleryPreferencesLoaded = false;
	public shouldAutoFillGalleryDefaults = false; public galleryTemplateTouched = false;
	public galleryController: GalleryViewController | null = null; public galleryToolbar: GalleryToolbar | null = null;
	public galleryViewStore = new GalleryViewStore(null); public activeGalleryViewId: string | null = null; public galleryViewsLoaded = false;
	private viewModeManager!: ViewModeManager; public previousNonSlideMode: 'table' | 'kanban' | 'gallery' = 'table';
	private readonly renderScheduler = new RenderScheduler(() => this.renderInternal());
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.navigation = true;
		initializeTableView(this);
		this.viewModeManager = new ViewModeManager(this);
	}
	getViewType(): string {
		return TABLE_VIEW_TYPE;
	}
	getDisplayText(): string {
		return buildTableViewTabTitle({
			file: this.file,
			filePath: this.file?.path ?? null
		});
	}
	public refreshDisplayText(): void {
		refreshTableViewDisplayText(this);
	}
	private syncQuickFilterContext(file: TFile | null): void {
		this.globalQuickFilterManager.setContext(file?.path ?? null);
		this.galleryQuickFilterManager.setContext(file?.path ?? null);
	}
	async setState(state: TableViewState, _result: unknown): Promise<void> {
		logger.debug("setState", state);
		try {
			const file = this.app.vault.getAbstractFileByPath(state.filePath);
			this.syncQuickFilterContext(file instanceof TFile ? file : null);
			if (file instanceof TFile) {
				this.file = file;
				this.conversionSession.prepare(file);
				this.magicMigrationController.resetPromptState();
				this.refreshCoordinator.setTrackedFile(file);
				this.kanbanBoardsLoaded = false;
				this.kanbanPreferencesLoaded = false;
				this.slidePreferencesLoaded = false;
				this.galleryPreferencesLoaded = false;
				this.shouldAutoFillSlideDefaults = false;
				this.shouldAutoFillGalleryDefaults = false;
				this.slideTemplateTouched = false;
				this.galleryTemplateTouched = false;
				this.slideConfig = normalizeSlideViewConfig(null);
				this.galleryConfig = normalizeSlideViewConfig(null);
				this.galleryViewStore.reset();
				this.activeGalleryViewId = null;
				this.galleryViewsLoaded = false;
				await this.render();
			} else {
				this.file = null;
				this.conversionSession.prepare(null);
				this.magicMigrationController.resetPromptState();
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
	async render(): Promise<void> { await this.renderScheduler.run(); }
	private async renderInternal(): Promise<void> {
		if (this.kanbanBoardController) {
			this.kanbanBoardController.ensureInitialized();
			this.kanbanBoardsLoaded = true;
		}
		const snapshot = this.refreshCoordinator ? this.refreshCoordinator.captureViewSnapshot() : null;
		await renderTableView(this);
		const rerenderMode = await this.viewModeManager.handleAfterRender();
		if (rerenderMode) {
			await renderTableView(this);
			if (rerenderMode === 'kanban') {
				await this.viewModeManager.handleAfterRender();
			}
		}
		if (this.refreshCoordinator) {
			await this.refreshCoordinator.finalizeRender(snapshot);
		}
		this.viewModeManager.updateButtons();
		this.refreshDisplayText();
	}
	async onOpen(): Promise<void> {
		ensureMarkdownToggle(this);
		this.viewModeManager.ensureActions();
		this.viewModeManager.updateButtons();
	}
	async onClose(): Promise<void> {
		await this.restoreSessionBaselineIfEligible();
		this.conversionSession.prepare(null);
		if (this.markdownToggleButton) {
			this.markdownToggleButton.remove();
			this.markdownToggleButton = null;
		}
			this.viewModeManager.detachActions();
			if (this.galleryFilterBar) {
				this.galleryFilterBar.destroy();
				this.galleryFilterBar = null;
			}
			if (this.galleryQuickFilterController) {
				this.galleryQuickFilterController.cleanup();
			}
			if (this.kanbanController) {
				this.kanbanController.destroy();
				this.kanbanController = null;
			}
			if (this.slideController) {
				this.slideController.destroy();
				this.slideController = null;
			}
			if (this.galleryController) {
				this.galleryController.destroy();
				this.galleryController = null;
			}
			if (this.galleryToolbar) {
				this.galleryToolbar.destroy();
				this.galleryToolbar = null;
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
		this.galleryViewStore.reset();
		this.activeGalleryViewId = null;
		this.galleryViewsLoaded = false;
		await handleOnClose(this);
		if (this.refreshCoordinator) {
			this.refreshCoordinator.dispose();
		}
	}
	onMoreOptions(menu: Menu): void { populateMoreOptionsMenu(this, menu); }
	public setKanbanHeightMode(mode: KanbanHeightMode): void {
		const normalized = sanitizeKanbanHeightMode(mode);
		if (this.kanbanHeightMode === normalized) {
			return;
		}
		this.kanbanHeightMode = normalized;
		if (this.kanbanController) {
			this.kanbanController.setHeightMode(normalized);
		}
		this.markUserMutation('kanban-height-mode');
		this.persistenceService?.scheduleSave();
	}
	public setKanbanMultiRowEnabled(enabled: boolean): void {
		if (this.kanbanMultiRowEnabled === enabled) {
			return;
		}
		this.kanbanMultiRowEnabled = enabled;
		if (this.kanbanController) {
			this.kanbanController.setMultiRowEnabled(enabled);
		}
		this.markUserMutation('kanban-multi-row');
		this.persistenceService?.scheduleSave();
	}
	public async setActiveViewMode(mode: 'table' | 'kanban' | 'slide' | 'gallery'): Promise<void> {
		await this.viewModeManager.setActiveViewMode(mode);
	}
	public captureConversionBaseline(content: string): void {
		this.conversionSession.captureBaseline(content);
	}
	public markUserMutation(reason?: string): void {
		this.conversionSession.markUserMutation(reason);
	}
	public hasUserMutations(): boolean {
		return this.conversionSession.hasUserMutations();
	}
	public async restoreSessionBaselineIfEligible(): Promise<boolean> {
		return this.conversionSession.restoreBaselineIfEligible();
	}
}
