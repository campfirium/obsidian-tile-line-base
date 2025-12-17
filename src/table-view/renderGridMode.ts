import type { TableView } from '../TableView';
import { clampColumnWidth } from '../grid/columnSizing';
import { buildColumnDefinitions, mountGrid } from './GridMountCoordinator';
import { renderFilterViewControls } from './TableViewFilterPresenter';
import { handleColumnResize, handleColumnOrderChange, handleHeaderEditEvent } from './TableViewInteractions';
import { handleStatusChange, handleCellEdit } from './TableCellInteractions';
import { handleCellLinkOpen } from './LinkNavigation';
import { applyStripeStyles } from './stripeStyles';
import { syncGridContainerTheme } from '../grid/themeSync';

interface RenderGridModeOptions {
	view: TableView;
	container: HTMLElement;
	ownerDoc: Document;
	primaryField: string | null;
	plugin: any;
}

export function renderGridMode(options: RenderGridModeOptions): void {
	const { view, container, ownerDoc, primaryField, plugin } = options;
	renderFilterViewControls(view, container);
	container.classList.add('tlb-has-grid');

	const columns = [
		{
			field: '#',
			headerName: '',
			headerTooltip: 'Index',
			editable: false
		},
		...buildColumnDefinitions({
			schema: view.schema!,
			columnConfigs: view.schema?.columnConfigs ?? null,
			primaryField,
			dataStore: view.dataStore,
			columnLayoutStore: view.columnLayoutStore,
			clampWidth: (value) => clampColumnWidth(value, { clampMax: false })
		})
	];

	const tableContainer = container.createDiv({ cls: 'tlb-table-container' });
	const { isDarkMode } = syncGridContainerTheme(tableContainer, { ownerDocument: ownerDoc });
	const stripeColorMode = plugin?.getStripeColorMode?.() ?? 'recommended';
	const stripeCustomColor = plugin?.getStripeCustomColor?.() ?? null;
	const borderColorMode = plugin?.getBorderColorMode?.() ?? 'recommended';
	const borderCustomColor = plugin?.getBorderCustomColor?.() ?? null;
	const borderContrast = plugin?.getBorderContrast?.() ?? 0.16;
	applyStripeStyles({
		container: tableContainer,
		ownerDocument: ownerDoc,
		stripeColorMode,
		stripeCustomColor,
		borderColorMode,
		borderCustomColor,
		borderContrast,
		isDarkMode
	});
	const hideRightSidebar = plugin?.isHideRightSidebarEnabled() ?? false;
	const sideBarVisible = !hideRightSidebar;

	const containerWindow = ownerDoc?.defaultView ?? window;
	const executeMount = () => {
		const { gridAdapter, container: gridContainer } = mountGrid({
			gridController: view.gridController,
			container: tableContainer,
			columns,
			rowData: view.filterOrchestrator.getVisibleRows(),
			sideBarVisible,
			handlers: {
				onStatusChange: (rowId, newStatus) => handleStatusChange(view, rowId, newStatus),
				onColumnResize: (field, width) => handleColumnResize(view, field, width),
				onCopySelectionAsTemplate: (rowIndex) => {
					void view.gridInteractionController.copySectionAsTemplate(rowIndex);
				},
				onCopyH2Section: (rowIndex) => {
					void view.gridInteractionController.copySectionAsTemplate(rowIndex);
				},
				onColumnOrderChange: (fields) => handleColumnOrderChange(view, fields),
				onModelUpdated: () => view.focusManager.handleGridModelUpdated(),
				onCellEdit: (event) => handleCellEdit(view, event),
				onHeaderEdit: (event) => handleHeaderEditEvent(view, event),
				onColumnHeaderContextMenu: (field, event) =>
					view.columnInteractionController.handleColumnHeaderContextMenu(field, event),
				onOpenCellLink: (context) => handleCellLinkOpen(view, context),
				onEnterAtLastRow: (field) => {
					const oldRowCount = view.blocks.length;
					view.rowInteractionController.addRow(oldRowCount, { focusField: field ?? null });
				},
				onRowDragEnd: (payload) => {
					view.rowInteractionController.reorderRowsByDrag(payload);
				}
			}
		});

		view.gridAdapter = gridAdapter;
		view.tableContainer = gridContainer;
		view.gridLayoutController.attach(gridContainer);
		view.filterOrchestrator.applyActiveView();
		view.gridInteractionController.attach(gridContainer);
	};

	if (containerWindow && typeof containerWindow.requestAnimationFrame === 'function') {
		containerWindow.requestAnimationFrame(() => {
			executeMount();
		});
	} else {
		executeMount();
	}
}
