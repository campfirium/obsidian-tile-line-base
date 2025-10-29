import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
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
	public gridInteractionController!: GridInteractionController;
	public filterOrchestrator!: FilterViewOrchestrator;
	public gridLayoutController!: GridLayoutController;
	public focusManager!: FocusManager;
	public globalQuickFilterController!: GlobalQuickFilterController;
	public copyTemplateController!: CopyTemplateController;
	public historyManager = new TableHistoryManager(this);
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

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		initializeTableView(this);
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
				await this.render();
				this.updateViewHeaderTitle();
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
		await renderTableView(this);
		this.updateViewHeaderTitle();
	}

	async onOpen(): Promise<void> {
		this.updateViewHeaderTitle();
		this.ensureMarkdownToggle();
	}

	async onClose(): Promise<void> {
		if (this.markdownToggleButton) {
			this.markdownToggleButton.remove();
			this.markdownToggleButton = null;
		}
		await handleOnClose(this);
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

	private updateViewHeaderTitle(): void {
		const leafElement = this.containerEl.closest(".workspace-leaf");
		if (!leafElement) {
			return;
		}
		const titleEl = leafElement.querySelector<HTMLElement>(".view-header-title");
		if (!titleEl) {
			return;
		}
		const label = this.file?.basename
			? t("tableView.titleWithFile", { name: this.file.basename })
			: t("tableView.displayName");
		if (titleEl.textContent !== label) {
			titleEl.textContent = label;
		}
		titleEl.setAttribute("aria-label", label);
		titleEl.setAttribute("title", label);
	}
}
