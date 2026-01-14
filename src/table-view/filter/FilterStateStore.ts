import { getPluginContext } from '../../pluginContext';
import type { ColumnState } from 'ag-grid-community';
import type {
	FileFilterViewState,
	FilterViewDefinition,
	SortRule,
	FilterViewMetadata,
	DefaultFilterViewPreferences
} from '../../types/filterView';

type FilterScope = 'table' | 'gallery';

export class FilterStateStore {
	private state: FileFilterViewState = { views: [], activeViewId: null, metadata: {} };
	private filePath: string | null;
	private readonly scope: FilterScope;

	constructor(filePath: string | null, scope: FilterScope = 'table') {
		this.filePath = filePath;
		this.scope = scope;
	}

	setFilePath(filePath: string | null): void {
		this.filePath = filePath;
	}

	resetState(): void {
		this.state = { views: [], activeViewId: null, metadata: {} };
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
			views: (next.views ?? []).map((view) => this.cloneFilterViewDefinition(view)),
			metadata: this.cloneMetadata(next.metadata)
		};
	}

	loadFromSettings = (): FileFilterViewState => {
		const plugin = getPluginContext();
		if (!plugin || !this.filePath) {
			this.resetState();
			return this.state;
		}
		const stored = this.scope === 'gallery'
			? plugin.getGalleryFilterViewsForFile(this.filePath)
			: plugin.getFilterViewsForFile(this.filePath);
		if (!stored) {
			this.resetState();
			return this.state;
		}
		const storedState = stored;
		const availableIds = new Set(storedState.views.map((view) => view.id));
		const activeId = storedState.activeViewId && availableIds.has(storedState.activeViewId)
			? storedState.activeViewId
			: null;
		this.state = {
			activeViewId: activeId,
			views: storedState.views.map((view) => this.cloneFilterViewDefinition(view)),
			metadata: this.cloneMetadata(storedState.metadata)
		};
		return this.state;
	};

	persist = async (): Promise<void> => {
		if (!this.filePath) {
			return;
		}
		const plugin = getPluginContext();
		if (!plugin) {
			return;
		}
		if (this.scope === 'gallery') {
			await plugin.saveGalleryFilterViewsForFile(this.filePath, this.state);
			return;
		}
		if (typeof plugin.saveFilterViewsForFile !== 'function') {
			return;
		}
		await plugin.saveFilterViewsForFile(this.filePath, this.state);
	};

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
			quickFilter: source.quickFilter ?? null,
			icon: this.sanitizeIconId(source.icon)
		};
	}

	updateState(updater: (state: FileFilterViewState) => void): void {
		updater(this.state);
	}

	findActiveView(): FilterViewDefinition | null {
		const activeId = this.state.activeViewId;
		return activeId ? this.state.views.find((view) => view.id === activeId) ?? null : null;
	}

	isStatusBaselineSeeded(): boolean {
		return !!this.state.metadata?.statusBaselineSeeded;
	}

	markStatusBaselineSeeded(): void {
		this.updateState((state) => {
			const metadata = this.ensureMetadata(state);
			metadata.statusBaselineSeeded = true;
		});
	}

	private ensureMetadata(state: FileFilterViewState): FilterViewMetadata {
		if (!state.metadata) {
			state.metadata = {};
		}
		return state.metadata;
	}

	private cloneMetadata(metadata: FilterViewMetadata | null | undefined): FilterViewMetadata {
		const result: FilterViewMetadata = {};
		if (metadata?.statusBaselineSeeded) {
			result.statusBaselineSeeded = true;
		}
		const defaultView = this.cloneDefaultViewPreferences(metadata?.defaultView);
		if (defaultView) {
			result.defaultView = defaultView;
		}
		return result;
	}

	private deepClone<T>(value: T): T {
		if (value == null) {
			return value;
		}
		return JSON.parse(JSON.stringify(value)) as T;
	}

	private sanitizeIconId(icon: unknown): string | null {
		if (typeof icon !== 'string') {
			return null;
		}
		const trimmed = icon.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private cloneDefaultViewPreferences(source: DefaultFilterViewPreferences | null | undefined): DefaultFilterViewPreferences | null {
		if (!source) {
			return null;
		}
		const result: DefaultFilterViewPreferences = {};
		const name = typeof source.name === 'string' ? source.name.trim() : '';
		if (name.length > 0) {
			result.name = name;
		}
		const icon = this.sanitizeIconId(source.icon);
		if (icon) {
			result.icon = icon;
		}
		return Object.keys(result).length > 0 ? result : null;
	}
}
