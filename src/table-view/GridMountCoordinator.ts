import type { ColumnDef, GridAdapter, RowData, RowDragEndPayload } from '../grid/GridAdapter';
import type { CellLinkClickContext } from '../types/cellLinks';
import type { Schema } from './SchemaBuilder';
import type { ColumnConfig } from './MarkdownBlockParser';
import type { TableDataStore } from './TableDataStore';
import type { GridController } from './GridController';
import { ColumnLayoutStore } from './ColumnLayoutStore';

interface ColumnBuilderParams {
	schema: Schema;
	columnConfigs: ColumnConfig[] | null | undefined;
	primaryField: string | null;
	dataStore: TableDataStore;
	columnLayoutStore: ColumnLayoutStore;
	clampWidth: (value: number) => number;
}

export function buildColumnDefinitions(params: ColumnBuilderParams): ColumnDef[] {
	const { schema, columnConfigs, primaryField, dataStore, columnLayoutStore, clampWidth } = params;
	const hiddenColumns = new Set(
		(columnConfigs ?? []).filter((config) => config.hide).map((config) => config.name)
	);

	return schema.columnNames.filter((name) => !hiddenColumns.has(name)).map((name) => {
		const baseColDef: ColumnDef = {
			field: name,
			headerName: name,
			editable: true
		};

		const normalizedName = name.trim().toLowerCase();
		if (normalizedName === 'status') {
			baseColDef.headerName = '';
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

		if (columnConfigs) {
			const config = columnConfigs.find((cfg) => cfg.name === name);
			if (config) {
				const configuredWidth = config.width?.trim();
				if (configuredWidth && configuredWidth !== 'auto') {
					applyConfiguredWidth(baseColDef, configuredWidth);
				}
			}
		}

		const columnType = dataStore.getColumnDisplayType(name);
		if (columnType === 'formula') {
			baseColDef.editable = false;
			(baseColDef as any).tooltipField = dataStore.getFormulaTooltipField(name);
		} else if (columnType === 'date') {
			baseColDef.editorType = 'date';
			baseColDef.dateFormat = dataStore.getDateFormat(name);
		} else if (columnType === 'time') {
			baseColDef.editorType = 'time';
			baseColDef.timeFormat = dataStore.getTimeFormat(name);
		}

		const storedWidth = columnLayoutStore.getWidth(name);
		if (typeof storedWidth === 'number' && name !== '#' && name !== 'status') {
			const width = clampWidth(storedWidth);
			(baseColDef as any).width = width;
			const context = (baseColDef as any).context ?? {};
			context.tlbStoredWidth = width;
			context.tlbWidthSource = 'manual';
			(baseColDef as any).context = context;
			(baseColDef as any).suppressSizeToFit = true;
		}

		return baseColDef;
	});
}

function applyConfiguredWidth(colDef: ColumnDef, widthExpression: string): void {
	if (widthExpression === 'flex') {
		(colDef as any).flex = 1;
		(colDef as any).minWidth = 200;
		return;
	}

	if (widthExpression.endsWith('%')) {
		const percentage = parseInt(widthExpression.replace('%', ''), 10);
		if (!Number.isNaN(percentage)) {
			(colDef as any).flex = percentage;
		}
		return;
	}

	if (widthExpression.endsWith('px')) {
		const pixels = parseInt(widthExpression.replace('px', ''), 10);
		if (!Number.isNaN(pixels)) {
			(colDef as any).width = pixels;
		}
		return;
	}

	const numeric = parseInt(widthExpression, 10);
	if (!Number.isNaN(numeric)) {
		(colDef as any).width = numeric;
	}
}

interface GridMountHandlers {
	onStatusChange: (rowId: string, newStatus: any) => void;
	onColumnResize: (field: string, width: number) => void;
	onCopyH2Section: (rowIndex: number) => void;
	onCopySelectionAsTemplate?: (rowIndex: number) => void;
	onColumnOrderChange: (fields: string[]) => void;
	onModelUpdated: () => void;
	onCellEdit: (event: any) => void;
	onHeaderEdit: (event: any) => void;
	onColumnHeaderContextMenu: (field: string, event: MouseEvent) => void;
	onEnterAtLastRow: (field: string | null) => void;
	onOpenCellLink: (context: CellLinkClickContext) => void;
	onRowDragEnd?: (event: RowDragEndPayload) => void;
}

interface GridMountParams {
	gridController: GridController;
	container: HTMLElement;
	columns: ColumnDef[];
	rowData: RowData[];
	handlers: GridMountHandlers;
	sideBarVisible?: boolean;
}

export function mountGrid(params: GridMountParams): { gridAdapter: GridAdapter; container: HTMLElement } {
	const { gridController, container, columns, rowData, handlers, sideBarVisible } = params;

	const result = gridController.mount(container, columns, rowData, {
		onStatusChange: handlers.onStatusChange,
		onColumnResize: handlers.onColumnResize,
		onCopyH2Section: handlers.onCopyH2Section,
		onCopySelectionAsTemplate: handlers.onCopySelectionAsTemplate,
		onColumnOrderChange: handlers.onColumnOrderChange,
		onModelUpdated: handlers.onModelUpdated,
		onCellEdit: handlers.onCellEdit,
		onHeaderEdit: handlers.onHeaderEdit,
		onColumnHeaderContextMenu: handlers.onColumnHeaderContextMenu,
		onEnterAtLastRow: handlers.onEnterAtLastRow,
		onOpenCellLink: handlers.onOpenCellLink,
		onRowDragEnd: handlers.onRowDragEnd
	}, {
		sideBarVisible: sideBarVisible !== false
	});

	return {
		gridAdapter: result.gridAdapter,
		container: result.container
	};
}
