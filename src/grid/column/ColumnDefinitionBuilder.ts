import type { ValueFormatterParams } from 'ag-grid-community';
import { Menu, setIcon } from 'obsidian';

import { ColumnDef as SchemaColumnDef } from '../GridAdapter';
import { createDateCellEditor } from '../editors/DateCellEditor';
import { createTimeCellEditor } from '../editors/TimeCellEditor';
import { COLUMN_MIN_WIDTH, clampColumnWidth } from '../columnSizing';
import { IconHeaderComponent } from '../headers/IconHeaderComponent';
import { createTextLinkCellRenderer } from '../../renderers/TextLinkCellRenderer';
import { formatDateForDisplay, formatTimeForDisplay } from '../../utils/datetime';
import { t } from '../../i18n';
import type { TlbCellRendererParams, TlbColDef } from '../agGridTypes';
import { formatUnknownValue } from '../../utils/valueFormat';
import { ALL_TASK_STATUSES, getStatusIcon, getStatusLabel, normalizeStatus, type TaskStatus } from '../../utils/status';

const INDEX_FIELD = '#';
const STATUS_FIELD = 'status';
const PINNED_FIELDS = new Set(['任务', '任务名称', 'task', 'taskName', 'title', '标题']);

export function buildAgGridColumnDefs(columns: SchemaColumnDef[]): TlbColDef[] {
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

function createIndexColumnDef(column: SchemaColumnDef): TlbColDef {
	return {
		field: column.field,
		headerName: column.headerName,
		headerClass: 'tlb-index-header-cell',
		editable: false,
		pinned: 'left',
		lockPinned: true,
		lockPosition: true,
		suppressMovable: true,
		cellRenderer: (params: TlbCellRendererParams) => {
			const value = params.value ?? '';
			const ownerDocument = params.eGridCell?.ownerDocument ?? activeDocument;
			const container = ownerDocument.createElement('span');
			container.classList.add('tlb-row-drag-handle');
				container.textContent = formatUnknownValue(value);
			return container;
		},
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

function createStatusColumnDef(column: SchemaColumnDef): TlbColDef {
	const headerName = column.headerName ?? 'Status';
	const headerAriaLabel = t('statusCell.headerAriaLabel');

	return {
		field: column.field,
		headerName,
		headerClass: 'tlb-status-header-cell',
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
		cellRenderer: createStatusCellRenderer,
		tooltipValueGetter: () => null,
		cellStyle: {
			textAlign: 'center',
			cursor: 'pointer',
			padding: '10px var(--ag-cell-horizontal-padding)'
		},
		headerComponent: IconHeaderComponent,
		headerComponentParams: {
			icon: 'list-checks',
			fallbacks: ['checklist', 'check-square'],
			tooltip: undefined,
			ariaLabel: headerAriaLabel
		}
	};
}

function createStatusCellRenderer(params: TlbCellRendererParams): HTMLElement {
	const ownerDocument = params.eGridCell?.ownerDocument ?? activeDocument;
	const container = ownerDocument.createElement('div');
	container.className = 'tlb-status-cell';
	container.tabIndex = 0;
	container.setAttribute('role', 'button');
	container.setAttribute('aria-haspopup', 'menu');
	container.setAttribute('aria-keyshortcuts', 'Space Enter Shift+F10');
	container.setAttribute('data-tlb-status-cell', 'true');
	container.setAttribute('data-tlb-tooltip-disabled', 'true');
	params.eGridCell?.setAttribute('data-tlb-tooltip-disabled', 'true');

	renderStatusCellContent(container, params);

	container.addEventListener('click', (event) => {
		event.stopPropagation();
		const currentStatus = normalizeStatus(params.data?.status);
		const nextStatus: TaskStatus = currentStatus === 'todo' ? 'done' : currentStatus === 'done' ? 'todo' : 'done';
		changeStatus(params, nextStatus);
	});

	container.addEventListener('contextmenu', (event) => {
		event.preventDefault();
		event.stopPropagation();
		showStatusMenu(params, event);
	});

	container.addEventListener('keydown', (event) => {
		const key = event.key;
		if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
			event.preventDefault();
			container.click();
			return;
		}
		if ((key === 'F10' && event.shiftKey) || key === 'ContextMenu' || key === 'Apps') {
			event.preventDefault();
			const rect = container.getBoundingClientRect();
			const menuEvent = new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2
			});
			showStatusMenu(params, menuEvent);
		}
	});

	return container;
}

function renderStatusCellContent(container: HTMLElement, params: TlbCellRendererParams): void {
	const status = normalizeStatus(params.data?.status);
	const iconId = getStatusIcon(status);
	const label = getStatusLabel(status);
	container.replaceChildren();
	container.setAttribute('data-status', status);

	const iconContainer = container.ownerDocument.createElement('span');
	iconContainer.className = 'tlb-status-icon';
	container.appendChild(iconContainer);
	setIcon(iconContainer, iconId);

	const srLabel = container.ownerDocument.createElement('span');
	srLabel.textContent = label;
	srLabel.className = 'tlb-visually-hidden';
	const srId = params.node?.id != null ? `tlb-status-sr-${params.node.id}` : `tlb-status-sr-${Date.now()}`;
	srLabel.id = srId;
	container.appendChild(srLabel);
	container.setAttribute('aria-labelledby', srId);
	container.setAttribute('aria-expanded', 'false');
}

function showStatusMenu(params: TlbCellRendererParams, event: MouseEvent): void {
	const currentStatus = normalizeStatus(params.data?.status);
	const menu = new Menu();
	for (const status of ALL_TASK_STATUSES) {
		menu.addItem((item) => {
			item
				.setTitle(getStatusLabel(status))
				.setIcon(getStatusIcon(status))
				.setDisabled(status === currentStatus)
				.onClick(() => {
					changeStatus(params, status);
				});
		});
	}
	menu.showAtMouseEvent(event);
}

function changeStatus(params: TlbCellRendererParams, newStatus: TaskStatus): void {
	const rowId = params.node?.id;
	if (!rowId) {
		return;
	}
	params.context?.onStatusChange?.(rowId, newStatus);
}

function createSchemaColumnDef(column: SchemaColumnDef): TlbColDef {
	const baseColDef: TlbColDef = {
		field: column.field,
		headerName: column.headerName,
		editable: column.editable,
		sortable: true,
		filter: false,
		resizable: true,
		cellClass: 'tlb-cell-truncate'
	};

	type ColumnDefWithOverrides = TlbColDef & SchemaColumnDef;
	const mergedColDef: ColumnDefWithOverrides = { ...baseColDef, ...column };

	if (!mergedColDef.cellRenderer) {
		mergedColDef.cellRenderer = createTextLinkCellRenderer();
	}

	const editorType = mergedColDef.editorType;
	if (editorType === 'date') {
		const format = mergedColDef.dateFormat ?? 'iso';
		mergedColDef.cellEditor = createDateCellEditor();
		mergedColDef.valueFormatter = (params: ValueFormatterParams) => formatDateForDisplay(params.value, format);
		mergedColDef.cellClass = appendCellClass(mergedColDef.cellClass, 'tlb-date-cell');
	} else if (editorType === 'time') {
		const format = mergedColDef.timeFormat ?? 'hh_mm';
		mergedColDef.cellEditor = createTimeCellEditor();
		mergedColDef.valueFormatter = (params: ValueFormatterParams) => formatTimeForDisplay(params.value, format);
		mergedColDef.cellClass = appendCellClass(mergedColDef.cellClass, 'tlb-time-cell');
	}

	delete mergedColDef.editorType;
	delete mergedColDef.dateFormat;
	delete mergedColDef.timeFormat;

	if (typeof column.field === 'string' && column.field !== INDEX_FIELD && column.field !== STATUS_FIELD) {
		mergedColDef.minWidth =
			typeof mergedColDef.minWidth === 'number'
				? clampColumnWidth(mergedColDef.minWidth)
				: COLUMN_MIN_WIDTH;
		if (typeof mergedColDef.maxWidth === 'number') {
			mergedColDef.maxWidth = clampColumnWidth(mergedColDef.maxWidth);
		} else {
			delete mergedColDef.maxWidth;
		}
	}

	if (typeof column.field === 'string' && PINNED_FIELDS.has(column.field)) {
		mergedColDef.pinned = 'left';
		mergedColDef.lockPinned = true;
	}

	const explicitWidth = mergedColDef.width;
	if (typeof explicitWidth === 'number') {
		const clamped = clampColumnWidth(explicitWidth);
		mergedColDef.width = clamped;
		mergedColDef.suppressSizeToFit = true;
	}

	return mergedColDef;
}

function appendCellClass(existing: TlbColDef['cellClass'], className: string): TlbColDef['cellClass'] {
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

function applyStatusColumnSizing(colDefs: TlbColDef[]): void {
	const statusColDef = colDefs.find((def) => def.field === STATUS_FIELD);
	if (!statusColDef) {
		return;
	}

	statusColDef.width = 80;
	statusColDef.minWidth = 72;
	statusColDef.maxWidth = 96;
}
