import { getLogger } from '../../utils/logger';

const logger = getLogger('table-view:global-quick-filter');

type QuickFilterListener = (value: string, source: unknown) => void;

class GlobalQuickFilterManager {
	private value = '';
	private listeners = new Set<QuickFilterListener>();
	private hostCount = 0;

	subscribe(listener: QuickFilterListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(value: string, source: unknown): void {
		this.value = value;
		for (const listener of this.listeners) {
			try {
				listener(value, source);
			} catch (error) {
				logger.error('[TileLineBase]', 'global quick filter listener failed', error);
			}
		}
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
			this.emit('', null);
		}
	}
}

export const globalQuickFilterManager = new GlobalQuickFilterManager();
