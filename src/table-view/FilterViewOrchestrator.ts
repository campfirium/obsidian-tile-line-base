import type { GridAdapter, RowData, SortModelEntry } from '../grid/GridAdapter';
import type { FileFilterViewState, SortRule } from '../types/filterView';
import { FilterDataProcessor } from './filter/FilterDataProcessor';
import type { TableDataStore } from './TableDataStore';

interface FilterViewOrchestratorDeps {
        dataStore: TableDataStore;
        getFilterViewState: () => FileFilterViewState;
        getGridAdapter: () => GridAdapter | null;
        getSchemaColumns: () => string[] | null;
        reapplyGlobalQuickFilter: () => void;
        emitFormulaLimitNotice: (limit: number) => void;
}

export class FilterViewOrchestrator {
        private allRows: RowData[] = [];
        private visibleRows: RowData[] = [];

        constructor(private readonly deps: FilterViewOrchestratorDeps) {}

        refresh(): void {
                this.allRows = this.deps.dataStore.extractRowData({
                        onFormulaLimitExceeded: (limit) => {
                                this.deps.emitFormulaLimitNotice(limit);
                        }
                });
                this.applyActiveView();
        }

        applyActiveView(): void {
                const state = this.deps.getFilterViewState();
                const targetId = state.activeViewId;
                const targetView = targetId ? state.views.find((view) => view.id === targetId) ?? null : null;
                const sortRules = targetView?.sortRules ?? [];

                const baseRows = !targetView || !targetView.filterRule
                        ? this.allRows
                        : FilterDataProcessor.applyFilterRule(this.allRows, targetView.filterRule);

                this.visibleRows = FilterDataProcessor.sortRowData(baseRows, sortRules);

                const adapter = this.deps.getGridAdapter();
                if (!adapter) {
                        return;
                }

                const api = (adapter as any).gridApi;
                if (api && typeof api.setGridOption === 'function') {
                        api.setGridOption('rowData', this.visibleRows);
                } else {
                        adapter.updateData(this.visibleRows);
                }

                this.applySortModel(adapter, sortRules);
                this.deps.reapplyGlobalQuickFilter();
        }

        getAllRows(): RowData[] {
                return this.allRows;
        }

        getVisibleRows(): RowData[] {
                return this.visibleRows;
        }

        private applySortModel(adapter: GridAdapter, sortRules: SortRule[]): void {
                if (!adapter.setSortModel) {
                        return;
                }

                const model: SortModelEntry[] = [];
                const visibleColumns = new Set<string>();
                const schemaColumns = this.deps.getSchemaColumns();
                if (schemaColumns) {
                        schemaColumns.forEach((column) => visibleColumns.add(column));
                }

                const columnState = adapter.getColumnState?.();
                if (columnState) {
                        for (const state of columnState) {
                                if (state.colId) {
                                        visibleColumns.add(state.colId);
                                }
                        }
                }

                for (const rule of sortRules ?? []) {
                        if (!rule?.column || !visibleColumns.has(rule.column)) {
                                continue;
                        }
                        model.push({
                                field: rule.column,
                                direction: rule.direction === 'desc' ? 'desc' : 'asc'
                        });
                }

                adapter.setSortModel(model);
        }
}
