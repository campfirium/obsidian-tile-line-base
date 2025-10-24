import type { TableView } from '../TableView';
import { clampColumnWidth } from '../grid/columnSizing';
import { getLogger } from '../utils/logger';
import { buildColumnDefinitions, mountGrid } from './GridMountCoordinator';
import { renderFilterViewControls } from './TableViewFilterPresenter';
import { handleStatusChange, handleColumnResize, handleColumnOrderChange, handleCellEdit, handleHeaderEditEvent } from './TableViewInteractions';
import type { ColumnConfig } from './MarkdownBlockParser';
import { t } from '../i18n';

const logger = getLogger('table-view:renderer');

export async function renderTableView(view: TableView): Promise<void> {
	const rootEl = view.containerEl;
	rootEl.classList.add('tile-line-base-view');

	const container = rootEl.children[1] as HTMLElement | undefined;
	if (!container) {
		return;
	}
	container.empty();
	container.classList.add('tlb-table-view-content');
	container.classList.remove('tlb-has-grid');

	const ownerDoc = container.ownerDocument;
	const ownerWindow = ownerDoc?.defaultView ?? null;
	logger.debug('render start', {
		file: view.file?.path,
		containerTag: container.tagName,
		containerClass: container.className,
		window: describeWindow(ownerWindow)
	});

	if (!view.file) {
		container.createDiv({ text: t('tableViewRenderer.noFile') });
		return;
	}

	view.columnLayoutStore.reset(view.file.path);
	view.configManager.reset();
	view.filterStateStore.setFilePath(view.file.path);
	view.filterStateStore.resetState();
	view.copyTemplate = null;

	const content = await view.app.vault.read(view.file);
	const configBlock = await view.persistenceService.loadConfig();

	if (configBlock) {
		if (configBlock.filterViews) {
			view.filterStateStore.setState(configBlock.filterViews);
		}
		if (configBlock.columnWidths) {
			view.columnLayoutStore.applyConfig(configBlock.columnWidths);
		}
		if (typeof configBlock.copyTemplate === 'string') {
			const loadedTemplate = configBlock.copyTemplate.replace(/\r\n/g, '\n');
			view.copyTemplate = loadedTemplate.trim().length > 0 ? loadedTemplate : null;
		}
	}

	view.filterViewState = view.filterStateStore.getState();

	let columnConfigs = view.markdownParser.parseHeaderConfig(content);
	if ((!columnConfigs || columnConfigs.length === 0) && configBlock?.columnConfigs) {
		columnConfigs = deserializeColumnConfigs(view, configBlock.columnConfigs);
	}

	const parsedBlocks = view.markdownParser.parseH2Blocks(content);
	if (parsedBlocks.length === 0) {
		container.createDiv({
			text: t('tableViewRenderer.missingH2'),
			cls: 'tlb-warning'
		});
		return;
	}

	view.blocks = parsedBlocks;

	const schemaResult = view.schemaBuilder.buildSchema(view.blocks, columnConfigs ?? null);
	view.dataStore.initialise(schemaResult, columnConfigs ?? null);
	view.schema = view.dataStore.getSchema();
	view.hiddenSortableFields = view.dataStore.getHiddenSortableFields();
	const dirtyFlags = view.dataStore.consumeDirtyFlags();
	view.schemaDirty = dirtyFlags.schemaDirty;
	view.sparseCleanupRequired = dirtyFlags.sparseCleanupRequired;

	if (!view.schema) {
		container.createDiv({ text: t('tableViewRenderer.noSchema') });
		return;
	}
	if (view.schemaDirty || view.sparseCleanupRequired) {
		view.persistenceService.scheduleSave();
		view.schemaDirty = false;
		view.sparseCleanupRequired = false;
	}

	if (!view.filterViewState || view.filterViewState.views.length === 0) {
		view.filterStateStore.loadFromSettings();
		view.filterViewState = view.filterStateStore.getState();
	}

	view.filterOrchestrator.refresh();
	view.initialColumnState = null;
	if (view.filterViewBar) {
		view.filterViewBar.destroy();
		view.filterViewBar = null;
	}

	renderFilterViewControls(view, container);

	container.classList.add('tlb-has-grid');

	const primaryField = view.schema.columnNames[0] ?? null;
	const columns = [
		{
			field: '#',
			headerName: '',
			headerTooltip: 'Index',
			editable: false
		},
		...buildColumnDefinitions({
			schema: view.schema,
			columnConfigs: view.schema.columnConfigs ?? null,
			primaryField,
			dataStore: view.dataStore,
			columnLayoutStore: view.columnLayoutStore,
			clampWidth: clampColumnWidth
		})
	];

	const isDarkMode = ownerDoc.body.classList.contains('theme-dark');
	const themeClass = isDarkMode ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';
	const tableContainer = container.createDiv({ cls: `tlb-table-container ${themeClass}` });

	const containerWindow = ownerDoc?.defaultView ?? window;
	const executeMount = () => {
		const { gridAdapter, container: gridContainer } = mountGrid({
			gridController: view.gridController,
			container: tableContainer,
			columns,
			rowData: view.filterOrchestrator.getVisibleRows(),
			handlers: {
				onStatusChange: (rowId, newStatus) => handleStatusChange(view, rowId, newStatus),
				onColumnResize: (field, width) => handleColumnResize(view, field, width),
				onCopyH2Section: (rowIndex) => {
					void view.gridInteractionController.copySectionAsTemplate(rowIndex);
				},
				onColumnOrderChange: (fields) => handleColumnOrderChange(view, fields),
				onModelUpdated: () => view.focusManager.handleGridModelUpdated(),
				onCellEdit: (event) => handleCellEdit(view, event),
				onHeaderEdit: (event) => handleHeaderEditEvent(view, event),
				onColumnHeaderContextMenu: (field, event) => view.columnInteractionController.handleColumnHeaderContextMenu(field, event),
				onEnterAtLastRow: (field) => {
					const oldRowCount = view.blocks.length;
					view.rowInteractionController.addRow(oldRowCount, { focusField: field ?? null });
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

function describeWindow(win: Window | null | undefined): Record<string, unknown> | null {
	if (!win) {
		return null;
	}
	let href: string | undefined;
	try {
		href = win.location?.href;
	} catch {
		href = undefined;
	}
	return { href, isMain: win === window };
}

function deserializeColumnConfigs(view: TableView, raw: unknown): ColumnConfig[] | null {
	if (!Array.isArray(raw)) {
		return null;
	}
	const result: ColumnConfig[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'string' || entry.trim().length === 0) {
			continue;
		}
		const config = view.markdownParser.parseColumnDefinition(entry);
		if (config) {
			result.push(config);
		}
	}
	return result.length > 0 ? result : null;
}

