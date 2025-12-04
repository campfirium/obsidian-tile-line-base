import type { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';
import { setIcon } from 'obsidian';
import { t } from '../i18n';
import type { DetectedCellLink, CellLinkClickContext } from '../types/cellLinks';
import { detectPrimaryCellLink } from '../utils/linkDetection';
import { ROW_ID_FIELD } from '../grid/GridAdapter';

export class TextLinkCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private textEl!: HTMLElement;
	private buttonEl: HTMLButtonElement | null = null;
	private params!: ICellRendererParams;
	private currentLink: DetectedCellLink | null = null;
	private buttonClickHandler?: (event: MouseEvent) => void;
	private buttonMouseDownHandler?: (event: MouseEvent) => void;
	private buttonKeydownHandler?: (event: KeyboardEvent) => void;

	init(params: ICellRendererParams): void {
		this.params = params;
		const doc = params.eGridCell?.ownerDocument ?? document;

		this.eGui = doc.createElement('div');
		this.eGui.className = 'tlb-link-cell';

		this.textEl = doc.createElement('span');
		this.textEl.className = 'tlb-link-cell__text';
		this.textEl.textContent = this.getDisplayValue(params);
		this.eGui.appendChild(this.textEl);

		this.renderLinkButton();
	}

	getGui(): HTMLElement {
		return this.eGui;
	}

	refresh(params: ICellRendererParams): boolean {
		this.params = params;
		this.textEl.textContent = this.getDisplayValue(params);
		this.renderLinkButton();
		return true;
	}

	destroy(): void {
		this.detachButtonEvents();
		this.buttonEl = null;
		this.buttonClickHandler = undefined;
		this.buttonMouseDownHandler = undefined;
		this.buttonKeydownHandler = undefined;
		this.currentLink = null;
	}

	private renderLinkButton(): void {
		const link = detectPrimaryCellLink(this.params.value);
		this.currentLink = link;

		if (!link) {
			this.detachButtonEvents();
			if (this.buttonEl?.isConnected) {
				this.buttonEl.remove();
			}
			this.buttonEl = null;
			return;
		}

		if (!this.buttonEl) {
			const doc = this.params.eGridCell?.ownerDocument ?? document;
			this.buttonEl = doc.createElement('button');
			this.buttonEl.type = 'button';
			this.buttonEl.className = 'tlb-link-cell__button';
			this.buttonEl.tabIndex = 0;
			this.eGui.appendChild(this.buttonEl);
			this.attachButtonEvents();
		}

		const iconId = link.type === 'internal' ? 'file' : 'external-link';
		const tooltipKey = link.type === 'internal' ? 'textLinkCell.openInternal' : 'textLinkCell.openExternal';
		const tooltip = t(tooltipKey, { target: link.displayText });

		const button = this.buttonEl;
		if (!button) {
			return;
		}
		setIcon(button, iconId);
		button.setAttribute('title', tooltip);
		button.setAttribute('aria-label', tooltip);
		button.dataset.linkType = link.type;
	}

	private attachButtonEvents(): void {
		if (!this.buttonEl) {
			return;
		}
		this.buttonClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.triggerLinkOpen();
		};
		this.buttonMouseDownHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
		};
		this.buttonKeydownHandler = (event: KeyboardEvent) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				event.stopPropagation();
				this.triggerLinkOpen();
			}
		};
		this.buttonEl.addEventListener('click', this.buttonClickHandler, { capture: false });
		this.buttonEl.addEventListener('mousedown', this.buttonMouseDownHandler, { capture: true });
		this.buttonEl.addEventListener('keydown', this.buttonKeydownHandler, { capture: false });
	}

	private detachButtonEvents(): void {
		if (this.buttonEl && this.buttonClickHandler) {
			this.buttonEl.removeEventListener('click', this.buttonClickHandler);
		}
		if (this.buttonEl && this.buttonMouseDownHandler) {
			this.buttonEl.removeEventListener('mousedown', this.buttonMouseDownHandler, true);
		}
		if (this.buttonEl && this.buttonKeydownHandler) {
			this.buttonEl.removeEventListener('keydown', this.buttonKeydownHandler);
		}
	}

	public shouldDisplayTooltip(): boolean {
		if (!this.textEl) {
			return false;
		}
		return this.textEl.scrollWidth > this.textEl.clientWidth + 1;
	}

	private triggerLinkOpen(): void {
		const context = this.params.context as { openCellLink?: (ctx: CellLinkClickContext) => void } | undefined;
		if (!context?.openCellLink || !this.currentLink) {
			return;
		}
		context.openCellLink({
			link: this.currentLink,
			field: this.params.colDef?.field ?? null,
			rowId: this.getRowId(),
			rawValue: this.getRawValue()
		});
	}

	private getRowId(): string | null {
		const fromNode = this.params.node?.id ?? null;
		if (fromNode) {
			return fromNode;
		}
		const data = this.params.data as Record<string, unknown> | null | undefined;
		const fallback = data ? data[ROW_ID_FIELD] : null;
		if (fallback == null) {
			return null;
		}
		const str = String(fallback);
		return str.length > 0 ? str : null;
	}

	private getRawValue(): string {
		const value = this.params.value;
		return typeof value === 'string' ? value : value != null ? String(value) : '';
	}

	private getDisplayValue(params: ICellRendererParams): string {
		const formatted = params.valueFormatted;
		if (typeof formatted === 'string') {
			return formatted;
		}
		if (formatted != null) {
			return String(formatted);
		}
		const value = params.value;
		if (typeof value === 'string') {
			return value;
		}
		if (value == null) {
			return '';
		}
		return String(value);
	}
}

export function createTextLinkCellRenderer(): { new(): TextLinkCellRenderer } {
	return TextLinkCellRenderer;
}
