import { ColDef } from 'ag-grid-community';

import { ColumnDef as SchemaColumnDef } from '../GridAdapter';
import { COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, clampColumnWidth } from '../columnSizing';
import { IconHeaderComponent } from '../headers/IconHeaderComponent';
import { StatusCellRenderer } from '../../renderers/StatusCellRenderer';

const INDEX_FIELD = '#';
const STATUS_FIELD = 'status';
const PINNED_FIELDS = new Set(['任务', '任务名称', 'task', 'taskName', 'title', '标题']);

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
	return {
		field: column.field,
		headerName: column.headerName,
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
		headerComponentParams: {
			icon: 'hashtag',
			fallbacks: ['hash'],
			tooltip: column.headerTooltip || column.headerName || 'Index'
		}
	};
}

function createStatusColumnDef(column: SchemaColumnDef): ColDef {
	const headerName = column.headerName ?? 'Status';
	const tooltipFallback =
		typeof headerName === 'string' && headerName.trim().length > 0 ? headerName : 'Status';

	return {
		field: column.field,
		headerName,
		headerTooltip: column.headerTooltip ?? tooltipFallback,
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
		cellStyle: {
			textAlign: 'center',
			cursor: 'pointer',
			padding: '10px var(--ag-cell-horizontal-padding)'
		},
		headerComponent: IconHeaderComponent,
		headerComponentParams: {
			icon: 'list-checks',
			fallbacks: ['checklist', 'check-square'],
			tooltip: column.headerTooltip ?? tooltipFallback
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
	}

	const explicitWidth = (mergedColDef as any).width;
	if (typeof explicitWidth === 'number') {
		const clamped = clampColumnWidth(explicitWidth);
		(mergedColDef as any).width = clamped;
		(mergedColDef as any).suppressSizeToFit = true;
	}

	return mergedColDef;
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
