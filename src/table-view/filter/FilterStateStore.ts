import { getPluginContext } from '../../pluginContext';
import type { ColumnState } from 'ag-grid-community';
import type { FileFilterViewState, FilterViewDefinition, FilterRule, SortRule } from '../../types/filterView';

export class FilterStateStore {
	private state: FileFilterViewState = { views: [], activeViewId: null };
	private filePath: string | null;

	constructor(filePath: string | null) {
		this.filePath = filePath;
	}

	setFilePath(filePath: string | null): void {
		this.filePath = filePath;
	}

	resetState(): void {
		this.state = { views: [], activeViewId: null };
	}

	getState(): FileFilterViewState {
		return this.state;
	}

	setState(next: FileFilterViewState | null | undefined): void {
		if (!next) {
			this.resetState();
			return;
		}
		this.state = {
			activeViewId: next.activeViewId ?? null,
			views: (next.views ?? []).map((view) => this.cloneFilterViewDefinition(view))
		};
	}

	loadFromSettings(): FileFilterViewState {
		const plugin = getPluginContext();
		if (!plugin || !this.filePath || typeof plugin.getFilterViewsForFile !== 'function') {
			this.resetState();
			return this.state;
		}
		const stored = plugin.getFilterViewsForFile(this.filePath);
		const availableIds = new Set(stored.views.map((view) => view.id));
		const activeId = stored.activeViewId && availableIds.has(stored.activeViewId)
			? stored.activeViewId
			: null;
		this.state = {
			activeViewId: activeId,
			views: stored.views.map((view) => this.cloneFilterViewDefinition(view))
		};
		return this.state;
	}

	async persist(): Promise<void> {
		if (!this.filePath) {
			return;
		}
		const plugin = getPluginContext();
		if (!plugin || typeof plugin.saveFilterViewsForFile !== 'function') {
			return;
		}
		await plugin.saveFilterViewsForFile(this.filePath, this.state);
	}

	cloneColumnState(state: ColumnState[] | null | undefined): ColumnState[] | null {
		if (!state) {
			return null;
		}
		return state.map((item) => ({ ...item }));
	}

	sanitizeSortRules(input: unknown): SortRule[] {
		if (!Array.isArray(input)) {
			return [];
		}
		const result: SortRule[] = [];
		for (const raw of input) {
			const candidate = raw as Partial<SortRule> & { column?: unknown; direction?: unknown };
			const column = typeof candidate?.column === 'string' ? candidate.column.trim() : '';
			if (!column) {
				continue;
			}
			const direction: 'asc' | 'desc' = candidate?.direction === 'desc' ? 'desc' : 'asc';
			result.push({ column, direction });
		}
		return result;
	}

	cloneFilterViewDefinition(source: FilterViewDefinition): FilterViewDefinition {
		return {
			id: source.id,
			name: source.name,
			filterRule: source.filterRule ? this.deepClone(source.filterRule) : null,
			sortRules: Array.isArray(source.sortRules)
				? source.sortRules.map((rule) => ({ column: rule.column, direction: rule.direction === 'desc' ? 'desc' : 'asc' }))
				: [],
			columnState: source.columnState ? this.deepClone(source.columnState) : null,
			quickFilter: source.quickFilter ?? null
		};
	}

	updateState(updater: (state: FileFilterViewState) => void): void {
		updater(this.state);
	}

	findActiveView(): FilterViewDefinition | null {
		const activeId = this.state.activeViewId;
		return activeId ? this.state.views.find((view) => view.id === activeId) ?? null : null;
	}

	private deepClone<T>(value: T): T {
		if (value == null) {
			return value;
		}
		return JSON.parse(JSON.stringify(value)) as T;
	}
}
