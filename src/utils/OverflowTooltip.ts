import { Component, MarkdownRenderer } from 'obsidian';
import { getPluginContext } from '../pluginContext';

interface TooltipState {
	container: HTMLElement;
	currentTarget: HTMLElement | null;
	hideTimer: number | null;
	width: number;
	maxHeight: number;
	wheelHandler: ((event: WheelEvent) => void) | null;
	wheelHandlerActive: boolean;
	markdownComponent?: Component;
}

const TOOLTIP_MIN_WIDTH = 420;
const TOOLTIP_MARGIN = 10;
const MIN_CELL_WIDTH = 160;
const CELL_EDGE_SAFE_GAP = 28;

const TOOLTIP_HALF_BLANK_CLASS = 'tlb-overflow-tooltip--half-blank';
const TOOLTIP_SPACER_CLASS = 'tlb-overflow-tooltip__spacer';
const TOOLTIP_BLANK_LINE_TOKEN = '&nbsp;';
const NBSP = '\u00a0';

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
		width: TOOLTIP_MIN_WIDTH,
		maxHeight: 0,
		wheelHandler: null,
		wheelHandlerActive: false
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

function resolveMaxHeight(view: Window): number {
	return Math.max(TOOLTIP_MARGIN * 2, view.innerHeight - TOOLTIP_MARGIN * 2);
}

function applyMaxHeight(container: HTMLElement, maxHeight: number): void {
	container.style.setProperty('--tlb-tooltip-max-height', `${Math.round(maxHeight)}px`);
}

function ensureWheelLock(state: TooltipState, doc: Document): void {
	if (state.wheelHandlerActive) {
		return;
	}
	if (!state.wheelHandler) {
		state.wheelHandler = (event: WheelEvent) => {
			if (state.container.hidden) {
				return;
			}
			const target = event.target as HTMLElement | null;
			if (target && state.container.contains(target)) {
				return;
			}
			event.preventDefault();
		};
	}
	doc.addEventListener('wheel', state.wheelHandler, { capture: true, passive: false });
	state.wheelHandlerActive = true;
}

function releaseWheelLock(state: TooltipState, doc: Document): void {
	if (!state.wheelHandlerActive || !state.wheelHandler) {
		return;
	}
	doc.removeEventListener('wheel', state.wheelHandler, { capture: true });
	state.wheelHandlerActive = false;
}

function normalizeTooltipMarkdown(content: string): string {
	const lines = content.replace(/\r\n?/g, '\n').split('\n');
	const normalized: string[] = [];
	let blankRun = 0;

	for (const line of lines) {
		if (line.trim().length === 0) {
			blankRun += 1;
			continue;
		}
		if (blankRun > 0) {
			normalized.push(TOOLTIP_BLANK_LINE_TOKEN);
		}
		blankRun = 0;
		normalized.push(line);
	}

	return normalized.join('\n');
}

function markTooltipBlankLines(container: HTMLElement): void {
	const paragraphs = Array.from(container.querySelectorAll<HTMLElement>('p'));
	for (const paragraph of paragraphs) {
		const rawText = paragraph.textContent ?? '';
		if (rawText.trim().length === 0 && rawText.includes(NBSP)) {
			paragraph.classList.add(TOOLTIP_SPACER_CLASS);
		}
	}
}

function replaceTooltipLineBreaks(container: HTMLElement): void {
	const breaks = Array.from(container.querySelectorAll('br'));
	for (const br of breaks) {
		const prev = br.previousSibling;
		const prevIsSpacer = prev instanceof HTMLElement && prev.classList.contains(TOOLTIP_SPACER_CLASS);
		const prevIsBr = prev?.nodeName === 'BR';
		if (!prevIsBr && !prevIsSpacer) {
			continue;
		}
		const spacer = container.ownerDocument.createElement('span');
		spacer.className = TOOLTIP_SPACER_CLASS;
		br.replaceWith(spacer);
	}
}

function clearTooltipContent(state: TooltipState): void {
	if (state.markdownComponent) {
		try {
			state.markdownComponent.unload();
		} catch {
			// ignore tooltip cleanup failures
		}
		state.markdownComponent = undefined;
	}
	state.container.textContent = '';
	state.container.classList.remove('markdown-rendered');
	state.container.classList.remove(TOOLTIP_HALF_BLANK_CLASS);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function resolveVisibleCellRect(cellRect: DOMRect, viewportWidth: number): DOMRect {
	const visibleLeft = clamp(cellRect.left, TOOLTIP_MARGIN, Math.max(TOOLTIP_MARGIN, viewportWidth - TOOLTIP_MARGIN));
	const visibleRight = clamp(cellRect.right, TOOLTIP_MARGIN, Math.max(TOOLTIP_MARGIN, viewportWidth - TOOLTIP_MARGIN));
	const left = Math.min(visibleLeft, visibleRight);
	const right = Math.max(visibleLeft, visibleRight);
	const width = Math.max(0, right - left);
	return new DOMRect(left, cellRect.top, width, cellRect.height);
}

function resolvePreservedCellEdge(cellRect: DOMRect, tooltipLeft: number, tooltipWidth: number): number {
	const tooltipRight = tooltipLeft + tooltipWidth;
	const openLeft = Math.max(0, Math.min(cellRect.right, tooltipLeft) - cellRect.left);
	const openRight = Math.max(0, cellRect.right - Math.max(cellRect.left, tooltipRight));
	return Math.max(openLeft, openRight);
}

function resolveHorizontalPosition(cellRect: DOMRect, tooltipWidth: number, viewportWidth: number): number {
	const visibleCellRect = resolveVisibleCellRect(cellRect, viewportWidth);
	const minLeft = TOOLTIP_MARGIN;
	const maxLeft = Math.max(minLeft, viewportWidth - tooltipWidth - TOOLTIP_MARGIN);
	if (maxLeft <= minLeft) {
		return minLeft;
	}

	const candidates = [
		visibleCellRect.left + CELL_EDGE_SAFE_GAP,
		visibleCellRect.right - CELL_EDGE_SAFE_GAP - tooltipWidth
	].map((desiredLeft) => {
		const left = clamp(desiredLeft, minLeft, maxLeft);
		return {
			left,
			preservedEdge: resolvePreservedCellEdge(visibleCellRect, left, tooltipWidth),
			adjustment: Math.abs(left - desiredLeft)
		};
	});

	candidates.sort((a, b) => {
		if (b.preservedEdge !== a.preservedEdge) {
			return b.preservedEdge - a.preservedEdge;
		}
		return a.adjustment - b.adjustment;
	});

	return candidates[0]?.left ?? minLeft;
}

function positionTooltip(container: HTMLElement, targetRect: DOMRect, view: Window, cellRect?: DOMRect): void {
	const containerRect = container.getBoundingClientRect();
	let top = targetRect.bottom + TOOLTIP_MARGIN;

	const viewportHeight = view.innerHeight;
	const viewportWidth = view.innerWidth;
	const anchorRect = cellRect ?? targetRect;
	let left = resolveHorizontalPosition(anchorRect, containerRect.width, viewportWidth);

	if (top + containerRect.height > viewportHeight) {
		top = targetRect.top - containerRect.height - TOOLTIP_MARGIN;
	}
	if (top < TOOLTIP_MARGIN) {
		top = TOOLTIP_MARGIN;
	}

	container.style.setProperty('--tlb-tooltip-top', `${Math.round(top)}px`);
	container.style.setProperty('--tlb-tooltip-left', `${Math.round(left)}px`);
}

interface TooltipWidthOptions {
	columnWidth?: number;
	cellRect?: DOMRect;
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
	const maxHeight = resolveMaxHeight(view);

	state.currentTarget = target;
	state.container.hidden = false;
	state.container.classList.remove('is-visible');
	state.width = width;
	state.maxHeight = maxHeight;
	applyWidth(state.container, width);
	applyMaxHeight(state.container, maxHeight);
	clearTooltipContent(state);
	ensureWheelLock(state, doc);

	const plugin = getPluginContext();
	const sourcePath = plugin?.app.workspace.getActiveFile()?.path ?? '';
	let renderPromise: Promise<void> | null = null;
	if (plugin) {
		const normalizedContent = normalizeTooltipMarkdown(content);
		state.container.classList.add('markdown-rendered');
		state.container.classList.add(TOOLTIP_HALF_BLANK_CLASS);
		const component = new Component();
		state.markdownComponent = component;
		renderPromise = MarkdownRenderer.render(
			plugin.app,
			normalizedContent,
			state.container,
			sourcePath,
			component
		).catch(() => {
			state.container.textContent = content;
		});
	} else {
		state.container.textContent = content;
	}

	view.requestAnimationFrame(() => {
		if (state.currentTarget !== target) {
			return;
		}
		const nextRect = target.getBoundingClientRect();
		positionTooltip(state.container, nextRect, view, options?.cellRect ?? nextRect);
		state.container.classList.add('is-visible');
	});

	if (renderPromise) {
		renderPromise
			.then(() => {
				if (state.currentTarget !== target) {
					return;
				}
				replaceTooltipLineBreaks(state.container);
				markTooltipBlankLines(state.container);
				const nextRect = target.getBoundingClientRect();
				positionTooltip(state.container, nextRect, view, options?.cellRect ?? nextRect);
			})
			.catch(() => undefined);
	}
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
		clearTooltipContent(state);
		state.container.classList.remove('is-visible');
		state.currentTarget = null;
		state.hideTimer = null;
		releaseWheelLock(state, doc);
	}, 50);
}
