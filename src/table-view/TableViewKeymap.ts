import { Scope } from 'obsidian';
import type { TableView } from '../TableView';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:keymap');

export function installTableViewGridF2Keybinding(view: TableView): void {
	if (!view.scope) {
		view.scope = new Scope(view.app.scope);
	}

	const scope = view.scope;
	const f2Handler = scope.register([], 'F2', (event) => {
		if (view.activeViewMode !== 'table') {
			return;
		}

		const container = view.tableContainer;
		if (!container) {
			return;
		}

		const ownerDoc = container.ownerDocument ?? document;
		const target = event.target as HTMLElement | null;
		const activeEl = ownerDoc.activeElement as HTMLElement | null;

		const isInsideGrid = (element: HTMLElement | null): boolean => {
			if (!element) {
				return false;
			}
			if (container.contains(element)) {
				return true;
			}
			if (element.classList.contains('tlb-ime-capture')) {
				return true;
			}
			if (element.closest('.tlb-ime-capture')) {
				return true;
			}
			return false;
		};

		if (!isInsideGrid(target) && !isInsideGrid(activeEl)) {
			return;
		}

		logger.trace('F2:grid', {
			mode: view.activeViewMode,
			target: target?.className ?? null,
			active: activeEl?.className ?? null
		});

		event.preventDefault();
		event.stopPropagation();

		const win = ownerDoc.defaultView ?? window;
		const schedule = (callback: () => void) => {
			if (typeof win.requestAnimationFrame === 'function') {
				win.requestAnimationFrame(() => callback());
			} else {
				win.setTimeout(callback, 0);
			}
		};

		schedule(() => {
			const gridAdapter = view.gridAdapter;
			const invoke = () => {
				gridAdapter?.startEditingFocusedCell?.();
			};

			if (gridAdapter && typeof gridAdapter.runWhenReady === 'function') {
				gridAdapter.runWhenReady(invoke);
			} else {
				invoke();
			}
		});

		return false;
	});

	view.register(() => scope.unregister(f2Handler));
}
