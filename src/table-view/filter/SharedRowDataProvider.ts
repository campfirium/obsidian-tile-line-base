import type { RowData } from '../../grid/GridAdapter';
import type { TableDataStore } from '../TableDataStore';

interface SharedRowDataProviderDeps {
	dataStore: TableDataStore;
	emitFormulaLimitNotice: (limit: number) => void;
}

export class SharedRowDataProvider {
	private rows: RowData[] | null = null;
	private cacheVersion = 0;
	private rowsVersion = -1;
	private clearScheduled = false;

	constructor(private readonly deps: SharedRowDataProviderDeps) {}

	invalidate(): void {
		this.cacheVersion++;
		this.rows = null;
	}

	getRows(): RowData[] {
		if (this.rows && this.rowsVersion === this.cacheVersion) {
			return this.rows;
		}

		const version = this.cacheVersion;
		this.rows = this.deps.dataStore.extractRowData({
			onFormulaLimitExceeded: (limit) => {
				this.deps.emitFormulaLimitNotice(limit);
			}
		});
		this.rowsVersion = version;
		this.scheduleClear();
		return this.rows;
	}

	private scheduleClear(): void {
		if (this.clearScheduled) {
			return;
		}
		this.clearScheduled = true;
		const clear = (): void => {
			this.clearScheduled = false;
			this.rows = null;
			this.rowsVersion = -1;
		};
		if (typeof queueMicrotask === 'function') {
			queueMicrotask(clear);
		} else {
			void Promise.resolve().then(clear, () => undefined);
		}
	}
}
