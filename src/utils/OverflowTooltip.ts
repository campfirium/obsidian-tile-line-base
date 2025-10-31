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
	container.style.top = '0px';
	container.style.left = '0px';
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

	container.style.top = `${Math.round(top)}px`;
	container.style.left = `${Math.round(left)}px`;
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
	state.container.style.opacity = '0';

	// 先渲染再定位以获取正确尺寸
	view.requestAnimationFrame(() => {
		if (state.currentTarget !== target) {
			return;
		}
		positionTooltip(state.container, target.getBoundingClientRect(), view);
		state.container.style.opacity = '1';
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
		state.container.style.opacity = '0';
		state.currentTarget = null;
		state.hideTimer = null;
	}, 50);
}
