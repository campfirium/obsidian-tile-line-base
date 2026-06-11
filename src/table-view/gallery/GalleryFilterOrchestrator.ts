import type { RowData } from '../../grid/GridAdapter';
import type { FileFilterViewState } from '../../types/filterView';
import { FilterDataProcessor } from '../filter/FilterDataProcessor';
import { getLogger } from '../../utils/logger';
import type { SharedRowDataProvider } from '../filter/SharedRowDataProvider';

interface GalleryFilterOrchestratorDeps {
	rowDataProvider: SharedRowDataProvider;
	getFilterViewState: () => FileFilterViewState;
}

export class GalleryFilterOrchestrator {
	private static readonly logger = getLogger('gallery:filter-orchestrator');
	private allRows: RowData[] = [];
	private visibleRows: RowData[] = [];
	private readonly listeners = new Set<(rows: RowData[]) => void>();

	constructor(private readonly deps: GalleryFilterOrchestratorDeps) {}

	refresh(): void {
		this.allRows = this.deps.rowDataProvider.getRows();
		this.applyActiveView();
	}

	invalidateRows(): void {
		this.deps.rowDataProvider.invalidate();
	}

	applyActiveView(): void {
		const state = this.deps.getFilterViewState();
		const targetId = state.activeViewId;
		const targetView = targetId ? state.views.find((entry) => entry.id === targetId) ?? null : null;
		const sortRules = targetView?.sortRules ?? [];
		const baseRows = !targetView?.filterRule
			? this.allRows
			: FilterDataProcessor.applyFilterRule(this.allRows, targetView.filterRule);
		this.visibleRows = FilterDataProcessor.sortRowData(baseRows, sortRules);
		this.notify();
	}

	getAllRows(): RowData[] {
		return this.allRows;
	}

	getVisibleRows(): RowData[] {
		return this.visibleRows;
	}

	addVisibleRowsListener(listener: (rows: RowData[]) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		if (this.listeners.size === 0) {
			return;
		}
		for (const listener of this.listeners) {
			try {
				listener(this.visibleRows);
			} catch (error) {
				GalleryFilterOrchestrator.logger.error('visibleRows listener failed', error);
			}
		}
	}

}
