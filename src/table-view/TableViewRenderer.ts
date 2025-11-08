import type { TableView } from '../TableView';
import { clampColumnWidth } from '../grid/columnSizing';
import { getLogger } from '../utils/logger';
import { buildColumnDefinitions, mountGrid } from './GridMountCoordinator';
import { renderFilterViewControls, syncTagGroupState } from './TableViewFilterPresenter';
import { handleColumnResize, handleColumnOrderChange, handleHeaderEditEvent } from './TableViewInteractions';
import { handleStatusChange, handleCellEdit } from './TableCellInteractions';
import { handleCellLinkOpen } from './LinkNavigation';
import type { ColumnConfig } from './MarkdownBlockParser';
import { t } from '../i18n';
import { getPluginContext } from '../pluginContext';
import { renderKanbanView } from './kanban/renderKanbanView';
import { sanitizeKanbanHeightMode } from './kanban/kanbanHeight';
import { sanitizeKanbanFontScale } from '../types/kanban';
import { renderKanbanToolbar } from './kanban/renderKanbanToolbar';

const logger = getLogger('table-view:renderer');

export async function renderTableView(view: TableView): Promise<void> {
	const rootEl = view.containerEl;
	rootEl.classList.add('tile-line-base-view');

	const container = rootEl.children[1] as HTMLElement | undefined;
	if (!container) { return; }
	container.empty();
	container.classList.add('tlb-table-view-content');
	container.classList.remove('tlb-has-grid');
	container.classList.remove('tlb-kanban-mode');

	if (view.gridAdapter) {
		view.gridController.destroy();
		view.gridAdapter = null;
		view.tableContainer = null;
	}
	if (view.kanbanController) {
		view.kanbanController.destroy();
		view.kanbanController = null;
	}

	const ownerDoc = container.ownerDocument;
	logger.debug('render start', {
		file: view.file?.path,
		containerTag: container.tagName,
		containerClass: container.className
	});

	if (!view.file) {
		container.createDiv({ text: t('tableViewRenderer.noFile') });
		return;
	}

	view.historyManager.reset();

	view.columnLayoutStore.reset(view.file.path);
	view.configManager.reset();
	view.filterStateStore.setFilePath(view.file.path);
	view.filterStateStore.resetState();
	view.tagGroupStore.setFilePath(view.file.path);
	view.tagGroupStore.resetState();
	syncTagGroupState(view);
	view.copyTemplate = null;

	const content = await view.app.vault.read(view.file);
	const configBlock = await view.persistenceService.loadConfig();

	view.pendingKanbanBoardState = configBlock?.kanbanBoards ?? null;

	if (configBlock) {
		if (configBlock.filterViews) {
			view.filterStateStore.setState(configBlock.filterViews);
		}
		if (configBlock.tagGroups) {
			view.tagGroupStore.setState(configBlock.tagGroups);
		}
		if (configBlock.columnWidths) {
			view.columnLayoutStore.applyConfig(configBlock.columnWidths);
		}
		if (typeof configBlock.copyTemplate === 'string') {
			const loadedTemplate = configBlock.copyTemplate.replace(/\r\n/g, '\n');
			view.copyTemplate = loadedTemplate.trim().length > 0 ? loadedTemplate : null;
		}
	}

	if (!view.kanbanPreferencesLoaded) {
		const preference = configBlock?.viewPreference;
		if (preference === 'kanban' || preference === 'table') {
			view.activeViewMode = preference;
		}
		const kanbanConfig = configBlock?.kanban;
		view.kanbanHeightMode = sanitizeKanbanHeightMode(kanbanConfig?.heightMode);
		if (typeof kanbanConfig?.fontScale === 'number') {
			view.kanbanFontScale = sanitizeKanbanFontScale(kanbanConfig.fontScale);
		}
		if (kanbanConfig && typeof kanbanConfig.laneField === 'string') {
			view.kanbanLaneField = kanbanConfig.laneField;
			if (typeof kanbanConfig.sortField === 'string') {
				view.kanbanSortField = kanbanConfig.sortField;
			}
			if (kanbanConfig.sortDirection === 'asc' || kanbanConfig.sortDirection === 'desc') {
				view.kanbanSortDirection = kanbanConfig.sortDirection;
			}
		}
		view.kanbanPreferencesLoaded = true;
	}

	view.filterViewState = view.filterStateStore.getState();
	syncTagGroupState(view);

	const headerColumnConfigs = view.markdownParser.parseHeaderConfig(content);
	const persistedColumnConfigs = configBlock?.columnConfigs
		? deserializeColumnConfigs(view, configBlock.columnConfigs)
		: null;
	const columnConfigs = mergeColumnConfigs(headerColumnConfigs, persistedColumnConfigs);

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
	if (!configBlock || configBlock.tagGroups == null) {
		view.tagGroupStore.loadFromSettings();
	}
	syncTagGroupState(view);
	view.tagGroupController.syncWithAvailableViews();
	syncTagGroupState(view);

	view.filterOrchestrator.refresh();
	view.initialColumnState = null;
	const primaryField = view.schema.columnNames[0] ?? null;

	if (view.filterViewBar) {
		view.filterViewBar.destroy();
		view.filterViewBar = null;
	}
	if (view.kanbanToolbar) {
		view.kanbanToolbar.destroy();
		view.kanbanToolbar = null;
	}

	if (view.activeViewMode === 'kanban') {
		renderKanbanToolbar(view, container);
		container.classList.add('tlb-kanban-mode');
		container.classList.remove('tlb-has-grid');
		const boardCount = view.kanbanBoardController?.getBoards().length ?? 0;
		if (boardCount === 0) {
			view.kanbanBoardController?.ensureBoardForActiveKanbanView();
			container.createDiv({
				cls: 'tlb-kanban-empty',
				text: t('kanbanView.toolbar.noBoardsPlaceholder')
			});
			return;
		}
		if (!view.kanbanLaneField) {
			container.createDiv({
				cls: 'tlb-kanban-warning',
				text: t('kanbanView.laneNotConfigured')
			});
			return;
		}
		const hiddenFields = view.hiddenSortableFields ?? new Set<string>();
		const sortField =
			view.kanbanSortField &&
			(view.schema.columnNames.includes(view.kanbanSortField) || hiddenFields.has(view.kanbanSortField))
				? view.kanbanSortField
				: null;
		renderKanbanView(view, container, {
			primaryField,
			laneField: view.kanbanLaneField,
			laneWidth: view.kanbanLaneWidth,
			fontScale: view.kanbanFontScale,
			sortField,
			heightMode: view.kanbanHeightMode,
			initialVisibleCount: view.kanbanInitialVisibleCount,
			content: view.kanbanCardContentConfig
		});
		view.filterOrchestrator.applyActiveView();
		return;
	}

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
			schema: view.schema,
			columnConfigs: view.schema.columnConfigs ?? null,
			primaryField,
			dataStore: view.dataStore,
			columnLayoutStore: view.columnLayoutStore,
			clampWidth: (value) => clampColumnWidth(value, { clampMax: false })
		})
	];

	const isDarkMode = ownerDoc.body.classList.contains('theme-dark');
	const themeClass = isDarkMode ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';
	const tableContainer = container.createDiv({ cls: `tlb-table-container ${themeClass}` });
	const plugin = getPluginContext();
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
				onColumnHeaderContextMenu: (field, event) => view.columnInteractionController.handleColumnHeaderContextMenu(field, event),
				onOpenCellLink: (context) => handleCellLinkOpen(view, context),
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


function mergeColumnConfigs(
	headerConfigs: ColumnConfig[] | null,
	persistedConfigs: ColumnConfig[] | null
): ColumnConfig[] | null {
	const baseList = headerConfigs ? headerConfigs.map((config) => ({ ...config })) : [];
	const overrideList = persistedConfigs ? persistedConfigs.map((config) => ({ ...config })) : [];
	if (baseList.length === 0 && overrideList.length === 0) {
		return null;
	}
	if (baseList.length === 0) {
		return overrideList;
	}
	const overrideMap = new Map<string, ColumnConfig>();
	for (const config of overrideList) {
		overrideMap.set(config.name, config);
	}
	const merged: ColumnConfig[] = [];
	for (const base of baseList) {
		const override = overrideMap.get(base.name);
		if (override) {
			merged.push({ ...base, ...override });
			overrideMap.delete(base.name);
		} else {
			merged.push(base);
		}
	}
	for (const remaining of overrideMap.values()) {
		merged.push(remaining);
	}
	return merged;
}

