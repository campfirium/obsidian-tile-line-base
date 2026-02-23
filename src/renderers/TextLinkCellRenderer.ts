import type { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';
import type { CellLinkClickContext, DetectedCellLink } from '../types/cellLinks';
import { ROW_ID_FIELD } from '../grid/GridAdapter';
import { formatUnknownValue } from '../utils/valueFormat';
import { parseCellLinkSegments } from '../utils/linkDetection';

export class TextLinkCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private textEl!: HTMLElement;
	private params!: ICellRendererParams;
	private currentLinks: DetectedCellLink[] = [];
	private textClickHandler?: (event: MouseEvent) => void;
	private textMouseDownHandler?: (event: MouseEvent) => void;
	private textKeydownHandler?: (event: KeyboardEvent) => void;

	init(params: ICellRendererParams): void {
		this.params = params;
		const doc = params.eGridCell?.ownerDocument ?? document;

		this.eGui = doc.createElement('div');
		this.eGui.className = 'tlb-link-cell';

		this.textEl = doc.createElement('span');
		this.textEl.className = 'tlb-link-cell__text';
		this.eGui.appendChild(this.textEl);
		this.attachTextEvents();
		this.renderContent();
	}

	getGui(): HTMLElement {
		return this.eGui;
	}

	refresh(params: ICellRendererParams): boolean {
		this.params = params;
		this.renderContent();
		return true;
	}

	destroy(): void {
		this.detachTextEvents();
		this.currentLinks = [];
	}

	public shouldDisplayTooltip(): boolean {
		if (!this.textEl) {
			return false;
		}
		return this.textEl.scrollWidth > this.textEl.clientWidth + 1;
	}

	private renderContent(): void {
		const rawValue = this.getRawValue();
		const segments = parseCellLinkSegments(rawValue);
		const hasLink = segments.some((segment) => segment.kind === 'link');
		this.currentLinks = [];

		if (!hasLink) {
			this.textEl.textContent = this.getDisplayValue(this.params);
			return;
		}

		const doc = this.params.eGridCell?.ownerDocument ?? document;
		const fragment = doc.createDocumentFragment();

		for (const segment of segments) {
			if (segment.kind === 'text') {
				fragment.appendChild(doc.createTextNode(segment.text));
				continue;
			}

			const linkIndex = this.currentLinks.length;
			this.currentLinks.push(segment.link);

			const anchor = doc.createElement('a');
			anchor.className = 'tlb-link-cell__anchor';
			anchor.textContent = segment.text;
			anchor.href = '#';
			anchor.tabIndex = 0;
			anchor.dataset.linkIndex = String(linkIndex);
			fragment.appendChild(anchor);
		}

		this.textEl.replaceChildren(fragment);
	}

	private attachTextEvents(): void {
		this.textClickHandler = (event: MouseEvent) => {
			const link = this.getLinkFromEventTarget(event.target);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.triggerLinkOpen(link);
		};

		this.textMouseDownHandler = (event: MouseEvent) => {
			const link = this.getLinkFromEventTarget(event.target);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		};

		this.textKeydownHandler = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			const link = this.getLinkFromEventTarget(event.target);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.triggerLinkOpen(link);
		};

		this.textEl.addEventListener('click', this.textClickHandler, { capture: false });
		this.textEl.addEventListener('mousedown', this.textMouseDownHandler, { capture: true });
		this.textEl.addEventListener('keydown', this.textKeydownHandler, { capture: false });
	}

	private detachTextEvents(): void {
		if (this.textClickHandler) {
			this.textEl.removeEventListener('click', this.textClickHandler);
		}
		if (this.textMouseDownHandler) {
			this.textEl.removeEventListener('mousedown', this.textMouseDownHandler, true);
		}
		if (this.textKeydownHandler) {
			this.textEl.removeEventListener('keydown', this.textKeydownHandler);
		}
	}

	private getLinkFromEventTarget(target: EventTarget | null): DetectedCellLink | null {
		if (!(target instanceof HTMLElement)) {
			return null;
		}
		const anchor = target.closest<HTMLElement>('.tlb-link-cell__anchor');
		if (!anchor || !this.textEl.contains(anchor)) {
			return null;
		}
		const indexText = anchor.dataset.linkIndex;
		if (!indexText) {
			return null;
		}
		const index = Number.parseInt(indexText, 10);
		if (!Number.isFinite(index) || index < 0 || index >= this.currentLinks.length) {
			return null;
		}
		return this.currentLinks[index] ?? null;
	}

	private triggerLinkOpen(link: DetectedCellLink): void {
		const context = this.params.context as { openCellLink?: (ctx: CellLinkClickContext) => void } | undefined;
		if (!context?.openCellLink) {
			return;
		}
		context.openCellLink({
			link,
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
		const str = formatUnknownValue(fallback);
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
