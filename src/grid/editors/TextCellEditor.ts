/**
 * TextCellEditor - 自定义文本编辑器
 *
 * 配合 CompositionProxy（合成代理层）使用：
 * - 首字符由 CompositionProxy 捕获后写入
 * - 编辑器负责显示与后续编辑
 * - 不使用 params.eventKey 或 params.charPress（已废弃）
 *
 * 参考文档：
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2.md
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2分析.md
 *
 * 使用工厂函数以兼容 Obsidian pop-out 窗口（避免跨窗口原型链问题）
 */

import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';
import { COLUMN_MAX_WIDTH } from '../columnSizing';

const MIN_POPUP_WIDTH = 420;
const MIN_CELL_WIDTH = 160;

export function createTextCellEditor() {
	return class implements ICellEditorComp {
		private wrapper!: HTMLDivElement;
		private eInput!: HTMLTextAreaElement;
		private params!: ICellEditorParams;
		private initialValue = '';
		private minHeight = 40;
		private cellWidth = MIN_POPUP_WIDTH;
		private cleanupTasks: Array<() => void> = [];
		private wrapperChrome = 0;
		private repositionHandler: (() => void) | null = null;

		init(params: ICellEditorParams): void {
			this.params = params;

			const doc = params.eGridCell?.ownerDocument || document;
			const wrapper = doc.createElement('div');
			wrapper.classList.add('tlb-text-editor-popup');
			wrapper.style.position = 'fixed';
			wrapper.style.left = '0px';
			wrapper.style.top = '0px';
			wrapper.style.pointerEvents = 'auto';
			this.wrapper = wrapper;

			const textarea = doc.createElement('textarea');
			textarea.classList.add('ag-cell-edit-input');
			textarea.setAttribute('rows', '1');
			textarea.style.width = '100%';
			textarea.style.minHeight = '0';
			textarea.style.resize = 'none';
			textarea.style.boxSizing = 'border-box';
			textarea.style.overflowY = 'hidden';
			this.eInput = textarea;

			this.wrapper.appendChild(this.eInput);

			this.initialValue = String(params.value ?? '');
			this.eInput.value = this.initialValue;

			const cellRect = params.eGridCell?.getBoundingClientRect();
			this.minHeight = Math.max(36, cellRect?.height ?? 36);
			const measuredWidth = Math.max(MIN_CELL_WIDTH, cellRect?.width ?? MIN_CELL_WIDTH);
			this.cellWidth = Math.max(MIN_POPUP_WIDTH, Math.min(COLUMN_MAX_WIDTH, Math.round(measuredWidth)));

			this.applyWrapperSize(this.minHeight, this.cellWidth);

			this.eInput.addEventListener('input', () => {
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
			if (this.initialValue) {
				this.eInput.select();
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
			this.repositionHandler = handler;
			win.addEventListener('resize', handler);
			win.addEventListener('scroll', handler, true);
			this.cleanupTasks.push(() => {
				win.removeEventListener('resize', handler);
				win.removeEventListener('scroll', handler, true);
				this.repositionHandler = null;
			});

			win.requestAnimationFrame(() => {
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
			this.repositionHandler = null;
		}

		isPopup(): boolean {
			return true;
		}

		getPopupPosition(): 'over' | 'under' | undefined {
			return 'over';
		}

		private applyWrapperSize(minHeight: number, width: number): void {
			this.wrapper.style.minHeight = `${minHeight}px`;
			this.wrapper.style.height = `${minHeight}px`;
			this.wrapper.style.minWidth = `${width}px`;
			this.wrapper.style.maxWidth = `${width}px`;
			this.wrapper.style.width = `${width}px`;
		}

		private adjustHeight(): void {
			const textarea = this.eInput;
			if (!textarea) {
				return;
			}
			const doc = textarea.ownerDocument ?? document;
			const win = doc.defaultView ?? window;
			const cellRect = this.params?.eGridCell?.getBoundingClientRect();
			const chrome = this.wrapperChrome;

			textarea.style.height = 'auto';
			textarea.style.overflowY = 'hidden';

			const scrollHeight = textarea.scrollHeight;
			let targetHeight = Math.max(this.minHeight, scrollHeight);

			if (cellRect && win) {
				const margin = 8;
				const spaceBelow = Math.floor(win.innerHeight - cellRect.top - margin);
				const spaceAbove = Math.floor(cellRect.bottom - margin);
				const viewportCap = Math.floor(win.innerHeight - margin * 2);
				const limit = Math.max(this.minHeight, Math.min(viewportCap, Math.max(spaceBelow, spaceAbove)));
				if (scrollHeight > limit) {
					targetHeight = limit;
					textarea.style.overflowY = 'auto';
				}
			}

			textarea.style.height = `${targetHeight}px`;
			const wrapperHeight = targetHeight + chrome;
			this.wrapper.style.height = `${wrapperHeight}px`;
			if (wrapperHeight > this.minHeight) {
				this.wrapper.style.minHeight = `${wrapperHeight}px`;
			}
		}

		private positionPopup(): void {
			const cellRect = this.params?.eGridCell?.getBoundingClientRect();
			if (!cellRect) {
				return;
			}
			const doc = this.wrapper.ownerDocument ?? document;
			const win = doc.defaultView ?? window;
			const margin = 8;

			const wrapperWidth = this.wrapper.offsetWidth || this.cellWidth;
			const wrapperHeight = this.wrapper.offsetHeight || this.minHeight + this.wrapperChrome;
			const viewportWidth = win.innerWidth;
			const viewportHeight = win.innerHeight;

			let left = Math.round(cellRect.left);
			let top = Math.round(cellRect.top);

			if (left + wrapperWidth > viewportWidth - margin) {
				left = Math.max(margin, viewportWidth - wrapperWidth - margin);
			}
			if (left < margin) {
				left = margin;
			}

			const spaceBelow = viewportHeight - cellRect.bottom;
			if (top + wrapperHeight + margin > viewportHeight && spaceBelow < wrapperHeight) {
				const candidateTop = Math.round(cellRect.bottom - wrapperHeight);
				top = Math.max(margin, candidateTop);
			}
			if (top + wrapperHeight > viewportHeight - margin) {
				top = Math.max(margin, viewportHeight - wrapperHeight - margin);
			}
			if (top < margin) {
				top = margin;
			}

			this.wrapper.style.left = `${left}px`;
			this.wrapper.style.top = `${top}px`;
		}

		private measureWrapperChrome(): void {
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
	};
}
