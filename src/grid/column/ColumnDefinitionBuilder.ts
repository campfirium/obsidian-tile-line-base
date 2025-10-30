import { ColDef, type Column, type ITooltipParams } from 'ag-grid-community';

import { ColumnDef as SchemaColumnDef } from '../GridAdapter';
import { createDateCellEditor } from '../editors/DateCellEditor';
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, clampColumnWidth } from '../columnSizing';
import { IconHeaderComponent } from '../headers/IconHeaderComponent';
import { StatusCellRenderer } from '../../renderers/StatusCellRenderer';
import { createTextLinkCellRenderer } from '../../renderers/TextLinkCellRenderer';
import { formatDateForDisplay } from '../../utils/datetime';

const INDEX_FIELD = '#';
const STATUS_FIELD = 'status';
type ColumnRole = 'index' | 'status' | 'primary' | 'data';
const PINNED_FIELDS = new Set(['任务', '任务名称', 'task', 'taskName', 'title', '标题']);
const TEXT_CELL_TOOLTIP_GETTER = createTextCellTooltipValueGetter();

export function buildAgGridColumnDefs(columns: SchemaColumnDef[]): ColDef[] {
	const colDefs = columns.map((schemaColumn) => {
		if (schemaColumn.field === INDEX_FIELD) {
			return createIndexColumnDef(schemaColumn);
		}

		if (schemaColumn.field === STATUS_FIELD) {
			return createStatusColumnDef(schemaColumn);
		}

		return createSchemaColumnDef(schemaColumn);
	});

	applyStatusColumnSizing(colDefs);

	return colDefs;
}

function createIndexColumnDef(column: SchemaColumnDef): ColDef {
	const baseContext = (column as any).context ?? {};
	return {
		field: column.field,
		headerName: column.headerName,
		headerClass: 'tlb-index-header-cell',
		editable: false,
		pinned: 'left',
		lockPinned: true,
		lockPosition: true,
		suppressMovable: true,
		width: 60,
		maxWidth: 80,
		sortable: true,
		filter: false,
		resizable: false,
		suppressSizeToFit: true,
		cellStyle: { textAlign: 'center' },
		headerComponent: IconHeaderComponent,
		context: {
			...baseContext,
			tlbColumnRole: 'index' as ColumnRole
		},
		headerComponentParams: {
			icon: 'hashtag',
			fallbacks: ['hash'],
			tooltip: column.headerTooltip || column.headerName || 'Index'
		}
	};
}

function createStatusColumnDef(column: SchemaColumnDef): ColDef {
	const headerName = column.headerName ?? 'Status';
	const baseContext = (column as any).context ?? {};

	return {
		field: column.field,
		headerName,
		headerClass: 'tlb-status-header-cell',
		headerTooltip: undefined,
		editable: false,
		pinned: 'left',
		lockPinned: true,
		lockPosition: true,
		suppressMovable: true,
		width: 60,
		resizable: false,
		sortable: true,
		filter: false,
		suppressSizeToFit: true,
		suppressNavigable: true,
		cellRenderer: StatusCellRenderer,
		tooltipValueGetter: () => null,
		cellStyle: {
			textAlign: 'center',
			cursor: 'pointer',
			padding: '10px var(--ag-cell-horizontal-padding)'
		},
		context: {
			...baseContext,
			tlbColumnRole: 'status' as ColumnRole
		},
		headerComponent: IconHeaderComponent,
		headerComponentParams: {
			icon: 'list-checks',
			fallbacks: ['checklist', 'check-square'],
			tooltip: undefined
		}
	};
}

function createSchemaColumnDef(column: SchemaColumnDef): ColDef {
	const baseColDef: ColDef = {
		field: column.field,
		headerName: column.headerName,
		editable: column.editable,
		sortable: true,
		filter: false,
		resizable: true,
		cellClass: 'tlb-cell-truncate'
	};

	const mergedColDef = { ...baseColDef, ...(column as unknown as ColDef) };
	const context: Record<string, unknown> = {
		...(mergedColDef as any).context
	};

	if (!mergedColDef.cellRenderer) {
		mergedColDef.cellRenderer = createTextLinkCellRenderer();
	}

	if ((column as any).editorType === 'date') {
		const format = (column as any).dateFormat ?? 'iso';
		(mergedColDef as any).cellEditor = createDateCellEditor();
		(mergedColDef as any).valueFormatter = (params: any) => formatDateForDisplay(params.value, format);
		if (!mergedColDef.tooltipField && !mergedColDef.tooltipValueGetter) {
			(mergedColDef as any).tooltipValueGetter = (params: any) => formatDateForDisplay(params.value, format);
		}
		mergedColDef.cellClass = appendCellClass(mergedColDef.cellClass, 'tlb-date-cell');
	}

	if (!mergedColDef.tooltipField && !mergedColDef.tooltipValueGetter) {
		(mergedColDef as any).tooltipShowMode = 'always';
		(mergedColDef as any).tooltipValueGetter = TEXT_CELL_TOOLTIP_GETTER;
	}

	delete (mergedColDef as any).editorType;
	delete (mergedColDef as any).dateFormat;

	if (typeof column.field === 'string' && column.field !== INDEX_FIELD && column.field !== STATUS_FIELD) {
		mergedColDef.minWidth =
			typeof mergedColDef.minWidth === 'number'
				? clampColumnWidth(mergedColDef.minWidth)
				: COLUMN_MIN_WIDTH;
		mergedColDef.maxWidth =
			typeof mergedColDef.maxWidth === 'number'
				? clampColumnWidth(mergedColDef.maxWidth)
				: COLUMN_MAX_WIDTH;
	}

	if (typeof column.field === 'string' && PINNED_FIELDS.has(column.field)) {
		mergedColDef.pinned = 'left';
		mergedColDef.lockPinned = true;
		context.tlbColumnRole = 'primary' as ColumnRole;
	}

	const explicitWidth = (mergedColDef as any).width;
	if (typeof explicitWidth === 'number') {
		const clamped = clampColumnWidth(explicitWidth);
		(mergedColDef as any).width = clamped;
		(mergedColDef as any).suppressSizeToFit = true;
	}

	if (!context.tlbColumnRole) {
		context.tlbColumnRole = 'data' as ColumnRole;
	}
	(mergedColDef as any).context = context;

	return mergedColDef;
}

function createTextCellTooltipValueGetter(): (params: ITooltipParams) => string | null {
	return (params: ITooltipParams): string | null => {
		const rawValue = params.value;
		if (rawValue == null || rawValue === '') {
			return null;
		}

		const api = params.api;
		const column = params.column;
		const isColumn = column && typeof (column as Column).getColId === 'function';
		const rowNode = params.node ?? null;

		if (api && isColumn && rowNode) {
			const instances = api.getCellRendererInstances({
				rowNodes: [rowNode as any],
				columns: [column as Column]
			});
			if (Array.isArray(instances)) {
				for (const instance of instances) {
					const candidate = instance as unknown as { shouldDisplayTooltip?: () => boolean };
					if (candidate && typeof candidate.shouldDisplayTooltip === 'function') {
						if (!candidate.shouldDisplayTooltip()) {
							return null;
						}
						break;
					}
				}
			}
		}

		return String(rawValue);
	};
}

function appendCellClass(existing: ColDef['cellClass'], className: string): ColDef['cellClass'] {
	if (!existing) {
		return className;
	}
	if (typeof existing === 'string') {
		const segments = existing.split(' ').filter((segment) => segment.trim().length > 0);
		if (segments.includes(className)) {
			return existing;
		}
		const appended = (existing + ' ' + className).trim();
		return appended;
	}
	if (Array.isArray(existing)) {
		return existing.includes(className) ? existing : [...existing, className];
	}
	return existing;
}

function applyStatusColumnSizing(colDefs: ColDef[]): void {
	const statusColDef = colDefs.find((def) => def.field === STATUS_FIELD);
	if (!statusColDef) {
		return;
	}

	statusColDef.width = 80;
	statusColDef.minWidth = 72;
	statusColDef.maxWidth = 96;
}
