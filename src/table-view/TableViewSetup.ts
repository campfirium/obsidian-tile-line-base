import { Notice } from 'obsidian';
import { getLogger } from '../utils/logger';
import { TableConfigManager } from './TableConfigManager';
import { ColumnInteractionController } from './ColumnInteractionController';
import { RowInteractionController } from './RowInteractionController';
import { GlobalQuickFilterController } from './GlobalQuickFilterController';
import { FilterViewOrchestrator } from './FilterViewOrchestrator';
import { GridInteractionController } from './GridInteractionController';
import { GridLayoutController } from './GridLayoutController';
import { FocusManager } from './FocusManager';
import { FilterViewController } from './filter/FilterViewController';
import { TagGroupController } from './filter/tag-group/TagGroupController';
import { TablePersistenceService } from './TablePersistenceService';
import { t } from '../i18n';
import { CopyTemplateController } from './CopyTemplateController';
import {
	getActiveFilterPrefills,
	persistColumnStructureChange,
	renameColumnInFilterViews,
	removeColumnFromFilterViews
} from './TableViewInteractions';
import { getAvailableColumns, persistFilterViews, persistTagGroups, syncFilterViewState, updateFilterViewBarTagGroupState } from './TableViewFilterPresenter';
import type { TableView } from '../TableView';

const logger = getLogger('table-view:setup');

export function initializeTableView(view: TableView): void {
	logger.info(t('tableViewSetup.constructorStart'));
	logger.debug('leaf', view.leaf);

	view.configManager = new TableConfigManager(view.app);
	view.persistenceService = new TablePersistenceService({
		app: view.app,
		dataStore: view.dataStore,
		columnLayoutStore: view.columnLayoutStore,
		configManager: view.configManager,
		filterStateStore: view.filterStateStore,
		getFile: () => view.file,
		getFilterViewState: () => view.filterViewState,
		getTagGroupState: () => view.tagGroupState,
		getCopyTemplate: () => view.copyTemplate ?? null
	});
	view.columnInteractionController = new ColumnInteractionController({
		app: view.app,
		dataStore: view.dataStore,
		columnLayoutStore: view.columnLayoutStore,
		getSchema: () => view.schema,
		renameColumnInFilterViews: (oldName, newName) => renameColumnInFilterViews(view, oldName, newName),
		removeColumnFromFilterViews: (name) => removeColumnFromFilterViews(view, name),
		persistColumnStructureChange: (options) => persistColumnStructureChange(view, options)
	});
	view.rowInteractionController = new RowInteractionController({
		dataStore: view.dataStore,
		getSchema: () => view.schema,
		getFocusedField: () => view.gridAdapter?.getFocusedCell?.()?.field ?? null,
		refreshGridData: () => view.filterOrchestrator.refresh(),
		focusRow: (rowIndex, field) => {
			view.focusManager.focusRow(rowIndex, field ?? null);
		},
		scheduleSave: () => {
			view.persistenceService.scheduleSave();
		},
		getActiveFilterPrefills: () => getActiveFilterPrefills(view)
	});
	view.copyTemplateController = new CopyTemplateController({
		app: view.app,
		dataStore: view.dataStore,
		getSchema: () => view.schema,
		getBlocks: () => view.blocks,
		getTemplate: () => view.copyTemplate,
		setTemplate: (template) => {
			view.copyTemplate = template;
		},
		persistTemplate: () => view.persistenceService.saveConfig()
	});
	view.globalQuickFilterController = new GlobalQuickFilterController({
		getGridAdapter: () => view.gridAdapter
	});
	view.filterOrchestrator = new FilterViewOrchestrator({
		dataStore: view.dataStore,
		getFilterViewState: () => view.filterViewState,
		getGridAdapter: () => view.gridAdapter,
		getSchemaColumns: () => view.schema?.columnNames ?? null,
		reapplyGlobalQuickFilter: () => view.globalQuickFilterController.reapply(),
		emitFormulaLimitNotice: (limit) => {
			new Notice(t('tableViewSetup.formulaLimitNotice', { limit: String(limit) }));
		}
	});
	view.gridInteractionController = new GridInteractionController({
		app: view.app,
		columnInteraction: view.columnInteractionController,
		rowInteraction: view.rowInteractionController,
		dataStore: view.dataStore,
		getGridAdapter: () => view.gridAdapter,
		copyTemplate: view.copyTemplateController
	});
	view.gridLayoutController = new GridLayoutController(view.app, view.gridController);
	view.focusManager = new FocusManager({
		getSchema: () => view.schema,
		getBlockCount: () => view.blocks.length,
		getVisibleRows: () => view.filterOrchestrator.getVisibleRows(),
		getGridAdapter: () => view.gridAdapter
	});
	view.filterViewController = new FilterViewController({
		app: view.app,
		stateStore: view.filterStateStore,
		getAvailableColumns: () => getAvailableColumns(view),
		persist: () => persistFilterViews(view),
		applyActiveFilterView: () => view.filterOrchestrator.applyActiveView(),
		syncState: () => syncFilterViewState(view),
		renderBar: () => {
			if (view.filterViewBar) {
				updateFilterViewBarTagGroupState(view);
				view.filterViewBar.render(view.filterViewState);
			}
		},
		tagGroupSupport: {
			onFilterViewRemoved: (viewId) => {
				view.tagGroupController?.handleFilterViewRemoval(viewId);
			},
			onShowAddToGroupMenu: (filterView, evt) => {
				view.tagGroupController?.openAddToGroupMenu(filterView, evt);
			},
			onFilterViewsUpdated: () => {
				view.tagGroupController?.syncWithAvailableViews();
			}
		}
	});
	view.tagGroupController = new TagGroupController({
		app: view.app,
		store: view.tagGroupStore,
		getFilterViewState: () => view.filterViewState,
		getAvailableColumns: () => getAvailableColumns(view),
		getUniqueFieldValues: (field, limit) => collectUniqueFieldValues(view, field, limit),
		ensureFilterViewsForFieldValues: (field, values) => view.filterViewController.ensureFilterViewsForFieldValues(field, values),
		activateFilterView: (viewId) => view.filterViewController.activateFilterView(viewId),
		renderBar: () => {
			if (view.filterViewBar) {
				updateFilterViewBarTagGroupState(view);
				view.filterViewBar.render(view.filterViewState);
			}
		},
		persist: () => persistTagGroups(view)
	});

	logger.info(t('tableViewSetup.constructorComplete'));
}
function collectUniqueFieldValues(view: TableView, field: string, limit: number): string[] {
	const rows = view.dataStore.extractRowData();
	const seen = new Set<string>();
	const result: string[] = [];
	for (const row of rows) {
		const raw = row[field];
		if (raw == null) {
			continue;
		}
		const value = typeof raw === 'string' ? raw : String(raw);
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
		if (Number.isFinite(limit) && limit > 0 && result.length >= limit) {
			break;
		}
	}
	return result;
}
