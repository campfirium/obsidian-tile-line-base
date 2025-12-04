import { getLogger } from '../../utils/logger';

const logger = getLogger('table-view:global-quick-filter');

type QuickFilterListener = (value: string, source: unknown) => void;

export class GlobalQuickFilterManager {
	private value = '';
	private listeners = new Set<QuickFilterListener>();
	private hostCount = 0;
	private context: string | null = null;
	private contextValues = new Map<string, string>();

	subscribe(listener: QuickFilterListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(value: string, source: unknown): void {
		this.setValue(value ?? '', source, false);
	}

	setContext(context: string | null): void {
		if (this.context) {
			this.contextValues.set(this.context, this.value);
		}
		if (this.context === context) {
			if (!context) {
				this.setValue('', this, true);
			}
			return;
		}
		this.context = context;
		const nextValue = context ? this.contextValues.get(context) ?? '' : '';
		this.setValue(nextValue, this, true);
	}

	getValue(): string {
		return this.value;
	}

	incrementHost(): void {
		this.hostCount++;
	}

	decrementHost(): void {
		this.hostCount = Math.max(0, this.hostCount - 1);
		if (this.hostCount === 0 && this.value) {
			this.setValue('', this, true);
		}
	}

	private setValue(value: string, source: unknown, forceNotify: boolean): void {
		this.value = value ?? '';
		if (this.context) {
			this.contextValues.set(this.context, this.value);
		}
		if (!forceNotify && this.listeners.size === 0) {
			return;
		}
		for (const listener of this.listeners) {
			try {
				listener(this.value, source);
			} catch (error) {
				logger.error('[TileLineBase]', 'global quick filter listener failed', error);
			}
		}
	}
}

export const globalQuickFilterManager = new GlobalQuickFilterManager();
