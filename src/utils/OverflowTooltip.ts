interface TooltipState {
	container: HTMLElement;
	currentTarget: HTMLElement | null;
	hideTimer: number | null;
}

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
		hideTimer: null
	};
	STATE_BY_DOCUMENT.set(doc, state);
	return state;
}

function positionTooltip(container: HTMLElement, targetRect: DOMRect, view: Window): void {
	const margin = 10;
	const containerRect = container.getBoundingClientRect();
	let top = targetRect.bottom + margin;
	let left = targetRect.left;

	const viewportHeight = view.innerHeight;
	const viewportWidth = view.innerWidth;

	if (top + containerRect.height > viewportHeight) {
		top = targetRect.top - containerRect.height - margin;
	}
	if (left + containerRect.width > viewportWidth) {
		left = viewportWidth - containerRect.width - margin;
	}
	if (left < margin) {
		left = margin;
	}
	if (top < margin) {
		top = margin;
	}

}

export function showOverflowTooltip(target: HTMLElement, content: string): void {
	const doc = target.ownerDocument ?? document;
	const view = doc.defaultView ?? window;
	const state = getOrCreateState(doc);

	if (state.hideTimer != null) {
		view.clearTimeout(state.hideTimer);
		state.hideTimer = null;
	}

	state.currentTarget = target;
	state.container.textContent = content;
	state.container.hidden = false;
	state.container.classList.remove('is-visible');

	// 先渲染再定位以获取正确尺寸
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
		state.container.classList.remove('is-visible');
		state.container.hidden = true;
		state.container.textContent = '';
		state.currentTarget = null;
		state.hideTimer = null;
	}, 50);
}
