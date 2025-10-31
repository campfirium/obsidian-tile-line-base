import type { ColumnState, GridApi } from 'ag-grid-community';
import type { SortModelEntry } from '../GridAdapter';
import type { AgGridColumnService } from '../column/AgGridColumnService';
import { deepClone } from '../utils/deepClone';

interface StateServiceDeps {
	getGridApi(): GridApi | null;
	runWhenReady(callback: () => void): void;
	columnService: AgGridColumnService;
}

export class AgGridStateService {
	private readonly deps: StateServiceDeps;

	constructor(deps: StateServiceDeps) {
		this.deps = deps;
	}

	getFilterModel(): any | null {
		const gridApi = this.deps.getGridApi();
		if (!gridApi || typeof gridApi.getFilterModel !== 'function') {
			return null;
		}
		return deepClone(gridApi.getFilterModel());
	}

	setFilterModel(model: any | null): void {
		this.deps.runWhenReady(() => {
			const gridApi = this.deps.getGridApi();
			if (!gridApi || typeof gridApi.setFilterModel !== 'function') {
				return;
			}
			const cloned = model == null ? null : deepClone(model);
			gridApi.setFilterModel(cloned);
			if (typeof gridApi.onFilterChanged === 'function') {
				gridApi.onFilterChanged();
			}
		});
	}

	setSortModel(sortModel: SortModelEntry[]): void {
		this.deps.runWhenReady(() => {
			this.deps.columnService.setSortModel(sortModel);
		});
	}

	setQuickFilter(value: string | null): void {
		this.deps.columnService.setQuickFilterText(value);
		this.deps.runWhenReady(() => {
			this.deps.columnService.applyQuickFilter();
		});
	}

	getColumnState(): ColumnState[] | null {
		return this.deps.columnService.getColumnState();
	}

	applyColumnState(state: ColumnState[] | null): void {
		this.deps.runWhenReady(() => {
			this.deps.columnService.applyColumnState(state);
		});
	}
}
