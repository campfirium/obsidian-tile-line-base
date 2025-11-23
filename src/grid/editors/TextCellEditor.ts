/**
 * TextCellEditor - custom AG Grid editor used together with the CompositionProxy.
 *
 * Notes:
 * - CompositionProxy captures and writes the first keystroke.
 * - This editor renders the textarea and handles subsequent editing.
 * - params.eventKey / params.charPress remain unused by design.
 *
 * Reference docs: docs/specs/251018 AG-Grid IME conflict investigation (parts 1 & 2).
 * The factory wrapper protects against prototype issues in Obsidian pop-out windows.
 */

import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';

const MIN_POPUP_WIDTH = 420;
const MIN_CELL_WIDTH = 160;
const VIEWPORT_MARGIN = 8;

function resolvePopupWidth(columnWidth: number, viewportWidth: number): number {
	const viewportLimit = Math.max(MIN_CELL_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
	const desired = Math.max(MIN_POPUP_WIDTH, columnWidth);
	return Math.min(desired, viewportLimit);
}

export function createTextCellEditor() {
	return class implements ICellEditorComp {
		private wrapper!: HTMLElement;
		private eInput!: HTMLTextAreaElement;
		private params!: ICellEditorParams;
		private initialValue = '';
		private minHeight = 40;
		private columnWidth = MIN_CELL_WIDTH;
		private usePopup = false;
		private cleanupTasks: Array<() => void> = [];
		private wrapperChrome = 0;
		private removeGridPropagationBlock?: () => void;

		init(params: ICellEditorParams): void {
			this.params = params;

			const doc = params.eGridCell?.ownerDocument || document;
			const cellRect = params.eGridCell?.getBoundingClientRect();
			this.minHeight = Math.max(36, cellRect?.height ?? 36);
			const rawWidth = Math.max(MIN_CELL_WIDTH, Math.round(cellRect?.width ?? MIN_CELL_WIDTH));
			this.columnWidth = rawWidth;

			const anchor = this.findContentElement(params.eGridCell ?? null);
			if (anchor) {
				const overflowed =
					Math.ceil(anchor.scrollWidth) > Math.floor(anchor.clientWidth + 1) ||
					Math.ceil(anchor.scrollHeight) > Math.floor(anchor.clientHeight + 1);
				this.usePopup = overflowed;
			} else {
				this.usePopup = false;
			}

			this.eInput = doc.createElement('textarea');
			this.eInput.classList.add('ag-cell-edit-input', 'tlb-text-editor-input');
			this.eInput.setAttribute('rows', '1');
			this.updateScrollableState(false);
			this.eInput.classList.remove('tlb-text-editor-input--inline');

			if (this.usePopup) {
				const wrapper = doc.createElement('div');
				wrapper.classList.add('tlb-text-editor-popup');
				wrapper.appendChild(this.eInput);
				this.wrapper = wrapper;
				const win = doc.defaultView ?? window;
				const initialWidth = resolvePopupWidth(this.columnWidth, win.innerWidth);
				this.applyWrapperSize(this.minHeight, initialWidth);
			} else {
				this.eInput.classList.add('tlb-text-editor-input--inline');
				this.wrapper = this.eInput;
			}

			this.initialValue = String(params.value ?? '');
			this.eInput.value = this.initialValue;

			this.eInput.addEventListener('input', () => {
				if (!this.usePopup) {
					return;
				}
				this.adjustHeight();
				this.positionPopup();
			});

			this.eInput.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					event.stopPropagation();
					params.stopEditing(false);
				} else if (event.key === 'Tab') {
					event.preventDefault();
					event.stopPropagation();
					params.stopEditing(false);
				} else if (event.key === 'Escape') {
					event.stopPropagation();
					params.stopEditing(true);
				}
			});
		}

		getGui(): HTMLElement {
			return this.wrapper;
		}

		afterGuiAttached(): void {
			this.eInput.focus();
			if (this.initialValue.length > 0) {
				this.eInput.select();
			}
			this.stopGridMousePropagation();

			if (!this.usePopup) {
				return;
			}

			this.measureWrapperChrome();
			this.adjustHeight();
			this.positionPopup();

			const doc = this.eInput.ownerDocument ?? document;
			const win = doc.defaultView ?? window;
			const handler = () => {
				this.measureWrapperChrome();
				this.adjustHeight();
				this.positionPopup();
			};
			win.addEventListener('resize', handler);
			win.addEventListener('scroll', handler, true);
			this.cleanupTasks.push(() => {
				win.removeEventListener('resize', handler);
				win.removeEventListener('scroll', handler, true);
			});

			win.requestAnimationFrame(() => {
				if (!this.usePopup) {
					return;
				}
				this.measureWrapperChrome();
				this.adjustHeight();
				this.positionPopup();
			});
		}

		getValue(): string {
			return this.eInput.value;
		}

		destroy(): void {
			for (const cleanup of this.cleanupTasks) {
				cleanup();
			}
			this.cleanupTasks = [];
		}

		isPopup(): boolean {
			return this.usePopup;
		}

		getPopupPosition(): 'over' | 'under' | undefined {
			return this.usePopup ? 'over' : undefined;
		}

		private applyWrapperSize(height: number, width: number): void {
			if (!this.usePopup) {
				return;
			}
			this.wrapper.style.minHeight = `${height}px`;
			this.wrapper.style.height = `${height}px`;
			this.wrapper.style.minWidth = `${width}px`;
			this.wrapper.style.maxWidth = `${width}px`;
			this.wrapper.style.width = `${width}px`;
		}

		private adjustHeight(): void {
			if (!this.usePopup) {
				return;
			}
			const textarea = this.eInput;
			const doc = textarea.ownerDocument ?? document;
			const win = doc.defaultView ?? window;
			const cellRect = this.params?.eGridCell?.getBoundingClientRect();

			textarea.style.removeProperty('height');
			this.updateScrollableState(false);

			const scrollHeight = textarea.scrollHeight;
			let targetHeight = Math.max(this.minHeight, scrollHeight);

			if (cellRect && win) {
				const spaceBelow = Math.floor(win.innerHeight - cellRect.top - VIEWPORT_MARGIN);
				const spaceAbove = Math.floor(cellRect.bottom - VIEWPORT_MARGIN);
				const viewportCap = Math.floor(win.innerHeight - VIEWPORT_MARGIN * 2);
				const limit = Math.max(this.minHeight, Math.min(viewportCap, Math.max(spaceBelow, spaceAbove)));
				if (scrollHeight > limit) {
					targetHeight = limit;
					this.updateScrollableState(true);
				}
			}

			textarea.style.height = `${targetHeight}px`;
			const wrapperHeight = targetHeight + this.wrapperChrome;
			this.wrapper.style.height = `${wrapperHeight}px`;
			if (wrapperHeight > this.minHeight) {
				this.wrapper.style.minHeight = `${wrapperHeight}px`;
			}
		}

		private positionPopup(): void {
			if (!this.usePopup) {
				return;
			}

			const cellRect = this.params?.eGridCell?.getBoundingClientRect();
			if (!cellRect) {
				return;
			}

			const doc = this.wrapper.ownerDocument ?? document;
			const win = doc.defaultView ?? window;
			const viewportWidth = win.innerWidth;
			const viewportHeight = win.innerHeight;

			const desiredWidth = resolvePopupWidth(this.columnWidth, viewportWidth);

			if (Math.abs((this.wrapper.offsetWidth || 0) - desiredWidth) > 0.5) {
				this.applyWrapperSize(this.wrapper.offsetHeight || this.minHeight, desiredWidth);
			}

			const wrapperWidth = this.wrapper.offsetWidth || desiredWidth;
			const wrapperHeight = this.wrapper.offsetHeight || this.minHeight + this.wrapperChrome;

			let left = Math.round(cellRect.left);
			let top = Math.round(cellRect.top);

			if (left + wrapperWidth > viewportWidth - VIEWPORT_MARGIN) {
				left = Math.max(VIEWPORT_MARGIN, viewportWidth - wrapperWidth - VIEWPORT_MARGIN);
			}
			if (left < VIEWPORT_MARGIN) {
				left = VIEWPORT_MARGIN;
			}

			const spaceBelow = viewportHeight - cellRect.bottom;
			if (top + wrapperHeight + VIEWPORT_MARGIN > viewportHeight && spaceBelow < wrapperHeight) {
				const candidateTop = Math.round(cellRect.bottom - wrapperHeight);
				top = Math.max(VIEWPORT_MARGIN, candidateTop);
			}
			if (top + wrapperHeight > viewportHeight - VIEWPORT_MARGIN) {
				top = Math.max(VIEWPORT_MARGIN, viewportHeight - wrapperHeight - VIEWPORT_MARGIN);
			}
			if (top < VIEWPORT_MARGIN) {
				top = VIEWPORT_MARGIN;
			}

			this.wrapper.style.left = `${left}px`;
			this.wrapper.style.top = `${top}px`;
		}

		private updateScrollableState(isScrollable: boolean): void {
			if (!this.eInput) {
				return;
			}
			this.eInput.classList.toggle('tlb-text-editor-input--scrollable', isScrollable);
		}

		private stopGridMousePropagation(): void {
			if (this.removeGridPropagationBlock) {
				return;
			}
			const stop = (event: Event) => {
				event.stopPropagation();
			};
			this.eInput.addEventListener('mousedown', stop);
			this.eInput.addEventListener('mouseup', stop);
			this.eInput.addEventListener('click', stop);
			this.eInput.addEventListener('dblclick', stop);
			this.removeGridPropagationBlock = () => {
				this.eInput.removeEventListener('mousedown', stop);
				this.eInput.removeEventListener('mouseup', stop);
				this.eInput.removeEventListener('click', stop);
				this.eInput.removeEventListener('dblclick', stop);
			};
			this.cleanupTasks.push(() => this.removeGridPropagationBlock?.());
		}

		private measureWrapperChrome(): void {
			if (!this.usePopup) {
				this.wrapperChrome = 0;
				return;
			}
			const doc = this.wrapper.ownerDocument ?? document;
			const win = doc.defaultView ?? window;
			const styles = win.getComputedStyle(this.wrapper);
			const parseLength = (value: string | null) => {
				if (!value) {
					return 0;
				}
				const parsed = parseFloat(value);
				return Number.isFinite(parsed) ? parsed : 0;
			};
			this.wrapperChrome =
				parseLength(styles.paddingTop) +
				parseLength(styles.paddingBottom) +
				parseLength(styles.borderTopWidth) +
				parseLength(styles.borderBottomWidth);
		}

		private findContentElement(cell: HTMLElement | null): HTMLElement | null {
			if (!cell) {
				return null;
			}
			return (
				cell.querySelector<HTMLElement>('.tlb-link-cell__text') ??
				cell.querySelector<HTMLElement>('.ag-cell-value') ??
				null
			);
		}

	};
}
