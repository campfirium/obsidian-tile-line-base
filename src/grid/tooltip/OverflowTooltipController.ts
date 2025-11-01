import { hideOverflowTooltip, showOverflowTooltip } from '../../utils/OverflowTooltip';

type EventTargetElement = HTMLElement & { closest(selector: string): HTMLElement | null };

export class OverflowTooltipController {
	private container: HTMLElement | null = null;
	private currentCell: HTMLElement | null = null;
	private currentAnchor: HTMLElement | null = null;

	private readonly pointerEnterHandler = (event: Event) => {
		const cell = this.findCell(event.target as EventTargetElement);
		if (!cell) {
			return;
		}
		this.handleEnter(cell);
	};

	private readonly pointerLeaveHandler = (event: Event) => {
		const cell = this.findCell(event.target as EventTargetElement);
		if (!cell) {
			return;
		}
		const related = (event as MouseEvent).relatedTarget as HTMLElement | null;
		if (related && cell.contains(related)) {
			return;
		}
		this.handleLeave(cell);
	};

	private readonly focusInHandler = (event: FocusEvent) => {
		const cell = this.findCell(event.target as EventTargetElement);
		if (!cell) {
			return;
		}
		this.handleEnter(cell);
	};

	private readonly focusOutHandler = (event: FocusEvent) => {
		const cell = this.findCell(event.target as EventTargetElement);
		if (!cell) {
			return;
		}
		const related = event.relatedTarget as HTMLElement | null;
		if (related && cell.contains(related)) {
			return;
		}
		this.handleLeave(cell);
	};

	private readonly scrollHandler = () => {
		this.hideCurrentTooltip();
	};

	attach(container: HTMLElement | null): void {
		if (this.container === container) {
			return;
		}
		this.detach();
		this.container = container;
		if (!container) {
			return;
		}
		container.addEventListener('pointerenter', this.pointerEnterHandler, true);
		container.addEventListener('pointerleave', this.pointerLeaveHandler, true);
		container.addEventListener('focusin', this.focusInHandler, true);
		container.addEventListener('focusout', this.focusOutHandler, true);
		container.addEventListener('scroll', this.scrollHandler, true);
		container.addEventListener('wheel', this.scrollHandler, true);
	}

	detach(): void {
		if (!this.container) {
			return;
		}
		this.container.removeEventListener('pointerenter', this.pointerEnterHandler, true);
		this.container.removeEventListener('pointerleave', this.pointerLeaveHandler, true);
		this.container.removeEventListener('focusin', this.focusInHandler, true);
		this.container.removeEventListener('focusout', this.focusOutHandler, true);
		this.container.removeEventListener('scroll', this.scrollHandler, true);
		this.container.removeEventListener('wheel', this.scrollHandler, true);
		this.hideCurrentTooltip();
		this.container = null;
	}

	private findCell(target: EventTargetElement | null): HTMLElement | null {
		return target ? target.closest('.ag-cell') : null;
	}

	private handleEnter(cell: HTMLElement): void {
		if (this.isTooltipDisabled(cell)) {
			return;
		}

		const { anchor, text } = this.extractTooltipTarget(cell);
		if (!anchor || !text) {
			return;
		}
		if (this.isTooltipDisabled(anchor)) {
			return;
		}
		if (!this.isOverflowing(anchor)) {
			return;
		}
		this.currentCell = cell;
		this.currentAnchor = anchor;
		const columnWidth = cell.getBoundingClientRect().width;
		showOverflowTooltip(anchor, text, { columnWidth });
	}

	private handleLeave(_cell: HTMLElement): void {
		this.hideCurrentTooltip();
	}

	private extractTooltipTarget(cell: HTMLElement): { anchor: HTMLElement | null; text: string | null } {
		const preferred = cell.querySelector<HTMLElement>('.tlb-link-cell__text');
		const fallback = cell.querySelector<HTMLElement>('.ag-cell-value');
		const anchor = preferred ?? fallback ?? null;
		const text = anchor?.textContent?.trim() ?? null;
		return { anchor, text };
	}

	private isTooltipDisabled(element: HTMLElement | null): boolean {
		if (!element) {
			return false;
		}
		if (element.getAttribute('data-tlb-tooltip-disabled') === 'true') {
			return true;
		}
		const disabledAncestor = element.closest('[data-tlb-tooltip-disabled="true"]');
		return Boolean(disabledAncestor);
	}

	private isOverflowing(element: HTMLElement): boolean {
		const widthOverflow = Math.ceil(element.scrollWidth) > Math.floor(element.clientWidth + 1);
		const heightOverflow = Math.ceil(element.scrollHeight) > Math.floor(element.clientHeight + 1);
		return widthOverflow || heightOverflow;
	}

	private hideCurrentTooltip(): void {
		if (this.currentAnchor) {
			hideOverflowTooltip(this.currentAnchor);
		}
		this.currentAnchor = null;
		this.currentCell = null;
	}
}
