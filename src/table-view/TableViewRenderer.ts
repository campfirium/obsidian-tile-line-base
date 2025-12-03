import type { TableView } from '../TableView';
import { clampColumnWidth } from '../grid/columnSizing';
import { getLogger } from '../utils/logger';
import { buildColumnDefinitions, mountGrid } from './GridMountCoordinator';
import { renderFilterViewControls, syncTagGroupState } from './TableViewFilterPresenter';
import { handleColumnResize, handleColumnOrderChange, handleHeaderEditEvent } from './TableViewInteractions';
import { handleStatusChange, handleCellEdit } from './TableCellInteractions';
import { handleCellLinkOpen } from './LinkNavigation';
import { t } from '../i18n';
import { getPluginContext } from '../pluginContext';
import { renderKanbanView } from './kanban/renderKanbanView';
import { sanitizeKanbanHeightMode } from './kanban/kanbanHeight';
import { sanitizeKanbanFontScale } from '../types/kanban';
import { renderKanbanToolbar } from './kanban/renderKanbanToolbar';
import { renderSlideMode } from './slide/renderSlideMode';
import { normalizeSlideViewConfig, stripSlideViewContent } from '../types/slide';
import { isSlideTemplateEmpty } from './slide/slideDefaults';
import { deserializeColumnConfigs, mergeColumnConfigs } from './columnConfigUtils';
import { applyStripeStyles } from './stripeStyles';

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
	container.classList.remove('tlb-slide-mode');

	if (view.gridAdapter) {
		view.gridController.destroy();
		view.gridAdapter = null;
		view.tableContainer = null;
	}
	if (view.kanbanController) {
		view.kanbanController.destroy();
		view.kanbanController = null;
	}
	if (view.slideController) {
		view.slideController.destroy();
		view.slideController = null;
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
	view.captureConversionBaseline(content);
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

	if (!view.slidePreferencesLoaded) {
		const preferredConfig = configBlock?.slide ?? view.slideConfig;
		const stripped = preferredConfig ? stripSlideViewContent(preferredConfig) : null;
		const normalized = normalizeSlideViewConfig(stripped ?? null);
		const templateEmpty = isSlideTemplateEmpty(normalized.template);
		view.slideConfig = normalized;
		view.shouldAutoFillSlideDefaults = !configBlock?.slide || templateEmpty;
		view.slideTemplateTouched = Boolean(configBlock?.slide && !templateEmpty);
		view.slidePreferencesLoaded = true;
	}

	if (!view.kanbanPreferencesLoaded) {
		const preference = configBlock?.viewPreference;
		if (preference === 'kanban' || preference === 'table' || preference === 'slide') view.activeViewMode = preference;
		const kanbanConfig = configBlock?.kanban;
		view.kanbanHeightMode = sanitizeKanbanHeightMode(kanbanConfig?.heightMode);
		view.kanbanMultiRowEnabled = kanbanConfig?.multiRow !== false;
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
	const hasStructuredBlocks = view.markdownParser.hasStructuredH2Blocks(parsedBlocks);
	if (!hasStructuredBlocks) {
		if (view.file) {
			view.magicMigrationController?.handleNonStandardFile({ container, content, file: view.file });
		} else {
			container.createDiv({ text: t('tableViewRenderer.missingH2'), cls: 'tlb-warning' });
		}
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
	view.kanbanBoardController?.processPendingLaneFieldRepairs();
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
	if (view.activeViewMode === 'slide') {
		renderSlideMode(view, container);
		return;
	}
	if (view.activeViewMode === 'kanban') {
		renderKanbanToolbar(view, container);
		container.classList.add('tlb-kanban-mode');
		container.classList.remove('tlb-has-grid');
		if ((view.kanbanBoardController?.getBoards().length ?? 0) === 0) {
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
			multiRowEnabled: view.kanbanMultiRowEnabled,
			initialVisibleCount: view.kanbanInitialVisibleCount,
			content: view.kanbanCardContentConfig,
			lanePresets: Array.isArray(view.kanbanLanePresets) ? view.kanbanLanePresets : [],
			laneOrder: Array.isArray(view.kanbanLaneOrder) ? view.kanbanLaneOrder : []
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
	const themeClass = isDarkMode ? 'ag-theme-quartz-dark' : 'ag-theme-quartz';
	const plugin = getPluginContext();
	const tableContainer = container.createDiv({ cls: `tlb-table-container ${themeClass}` });
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
				onColumnHeaderContextMenu: (field, event) => view.columnInteractionController.handleColumnHeaderContextMenu(field, event),
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
