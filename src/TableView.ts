import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { ColumnState } from "ag-grid-community";
import type { GridAdapter } from "./grid/GridAdapter";
import { debugLog } from "./utils/logger";
import { ColumnLayoutStore } from "./table-view/ColumnLayoutStore";
import { GridController } from "./table-view/GridController";
import { MarkdownBlockParser, H2Block } from "./table-view/MarkdownBlockParser";
import { SchemaBuilder, Schema } from "./table-view/SchemaBuilder";
import { FilterStateStore } from "./table-view/filter/FilterStateStore";
import type { FilterViewBar } from "./table-view/filter/FilterViewBar";
import type { FilterViewController } from "./table-view/filter/FilterViewController";
import type { FileFilterViewState } from "./types/filterView";
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

export const TABLE_VIEW_TYPE = "tile-line-base-table";

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
	public tableContainer: HTMLElement | null = null;
	public filterViewBar: FilterViewBar | null = null;
	public filterViewController!: FilterViewController;
	public filterStateStore = new FilterStateStore(null);
	public filterViewState: FileFilterViewState = this.filterStateStore.getState();
	public initialColumnState: ColumnState[] | null = null;

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
		debugLog("[TableView] setState", state);
		try {
			const file = this.app.vault.getAbstractFileByPath(state.filePath);
			if (file instanceof TFile) {
				this.file = file;
				await this.render();
			}
		} catch (error) {
			console.error("[TableView] setState failed", error);
			throw error;
		}
	}

	getState(): TableViewState {
		return { filePath: this.file?.path ?? "" };
	}

	async render(): Promise<void> {
		await renderTableView(this);
	}

	async onClose(): Promise<void> {
		await handleOnClose(this);
	}
}

