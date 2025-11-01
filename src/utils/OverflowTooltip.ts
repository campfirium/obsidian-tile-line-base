interface TooltipState {
	container: HTMLElement;
	currentTarget: HTMLElement | null;
	hideTimer: number | null;
	width: number;
}

const TOOLTIP_MIN_WIDTH = 420;
const TOOLTIP_MARGIN = 10;
const MIN_CELL_WIDTH = 160;

const STATE_BY_DOCUMENT = new WeakMap<Document, TooltipState>();

function getOrCreateState(doc: Document): TooltipState {
	let state = STATE_BY_DOCUMENT.get(doc);
	if (state) {
		return state;
	}

	const container = doc.createElement('div');
	container.className = 'tlb-overflow-tooltip';
	container.hidden = true;
	doc.body.appendChild(container);

	state = {
		container,
		currentTarget: null,
		hideTimer: null,
		width: TOOLTIP_MIN_WIDTH
	};
	STATE_BY_DOCUMENT.set(doc, state);
	return state;
}

function resolveWidth(columnWidth: number, view: Window): number {
	const viewportLimit = Math.max(MIN_CELL_WIDTH, view.innerWidth - TOOLTIP_MARGIN * 2);
	const desired = Math.max(TOOLTIP_MIN_WIDTH, columnWidth);
	return Math.min(desired, viewportLimit);
}

function applyWidth(container: HTMLElement, width: number): void {
	const value = `${width}px`;
	container.style.setProperty('--tlb-tooltip-width', value);
}

function positionTooltip(container: HTMLElement, targetRect: DOMRect, view: Window): void {
	const containerRect = container.getBoundingClientRect();
	let top = targetRect.bottom + TOOLTIP_MARGIN;
	let left = targetRect.left;

	const viewportHeight = view.innerHeight;
	const viewportWidth = view.innerWidth;

	if (top + containerRect.height > viewportHeight) {
		top = targetRect.top - containerRect.height - TOOLTIP_MARGIN;
	}
	if (left + containerRect.width > viewportWidth - TOOLTIP_MARGIN) {
		left = viewportWidth - containerRect.width - TOOLTIP_MARGIN;
	}
	if (left < TOOLTIP_MARGIN) {
		left = TOOLTIP_MARGIN;
	}
	if (top < TOOLTIP_MARGIN) {
		top = TOOLTIP_MARGIN;
	}

	container.style.setProperty('--tlb-tooltip-top', `${Math.round(top)}px`);
	container.style.setProperty('--tlb-tooltip-left', `${Math.round(left)}px`);
}

interface TooltipWidthOptions {
	columnWidth?: number;
}

export function showOverflowTooltip(target: HTMLElement, content: string, options?: TooltipWidthOptions): void {
	const doc = target.ownerDocument ?? document;
	const view = doc.defaultView ?? window;
	const state = getOrCreateState(doc);

	if (state.hideTimer != null) {
		view.clearTimeout(state.hideTimer);
		state.hideTimer = null;
	}

	const rect = target.getBoundingClientRect();
	const columnWidth = Math.max(MIN_CELL_WIDTH, Math.round(options?.columnWidth ?? rect.width ?? target.clientWidth));
	const width = resolveWidth(columnWidth, view);

	state.currentTarget = target;
	state.container.textContent = content;
	state.container.hidden = false;
	state.container.classList.remove('is-visible');
	state.width = width;
	applyWidth(state.container, width);

	view.requestAnimationFrame(() => {
		if (state.currentTarget !== target) {
			return;
		}
		positionTooltip(state.container, target.getBoundingClientRect(), view);
		state.container.classList.add('is-visible');
	});
}

export function hideOverflowTooltip(target: HTMLElement): void {
	const doc = target.ownerDocument ?? document;
	const view = doc.defaultView ?? window;
	const state = getOrCreateState(doc);
	if (state.currentTarget !== target) {
		return;
	}

	state.hideTimer = view.setTimeout(() => {
		state.container.hidden = true;
		state.container.textContent = '';
		state.container.classList.remove('is-visible');
		state.currentTarget = null;
		state.hideTimer = null;
	}, 50);
}
