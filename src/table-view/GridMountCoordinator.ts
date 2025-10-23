import type { ColumnDef, GridAdapter, RowData } from '../grid/GridAdapter';
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

	return schema.columnNames.map((name) => {
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

		if (columnConfigs) {
			const config = columnConfigs.find((cfg) => cfg.name === name);
			if (config) {
				const configuredWidth = config.width?.trim();
				if (configuredWidth && configuredWidth !== 'auto') {
					applyConfiguredWidth(baseColDef, configuredWidth);
				}
			}
		}

		if (dataStore.isFormulaColumn(name)) {
			baseColDef.editable = false;
			(baseColDef as any).tooltipField = dataStore.getFormulaTooltipField(name);
		}

		const storedWidth = columnLayoutStore.getWidth(name);
		if (typeof storedWidth === 'number' && name !== '#' && name !== 'status') {
			const width = clampWidth(storedWidth);
			(baseColDef as any).width = width;
			(baseColDef as any).__tlbStoredWidth = width;
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
	onColumnOrderChange: (fields: string[]) => void;
	onModelUpdated: () => void;
	onCellEdit: (event: any) => void;
	onHeaderEdit: (event: any) => void;
	onColumnHeaderContextMenu: (field: string, event: MouseEvent) => void;
	onEnterAtLastRow: (field: string | null) => void;
}

interface GridMountParams {
	gridController: GridController;
	container: HTMLElement;
	columns: ColumnDef[];
	rowData: RowData[];
	handlers: GridMountHandlers;
}

export function mountGrid(params: GridMountParams): { gridAdapter: GridAdapter; container: HTMLElement } {
	const { gridController, container, columns, rowData, handlers } = params;

	const result = gridController.mount(container, columns, rowData, {
		onStatusChange: handlers.onStatusChange,
		onColumnResize: handlers.onColumnResize,
		onCopyH2Section: handlers.onCopyH2Section,
		onColumnOrderChange: handlers.onColumnOrderChange,
		onModelUpdated: handlers.onModelUpdated,
		onCellEdit: handlers.onCellEdit,
		onHeaderEdit: handlers.onHeaderEdit,
		onColumnHeaderContextMenu: handlers.onColumnHeaderContextMenu,
		onEnterAtLastRow: handlers.onEnterAtLastRow
	});

	return {
		gridAdapter: result.gridAdapter,
		container: result.container
	};
}
