import type { App } from 'obsidian';
import { classifyLinkTarget } from '../utils/linkDetection';
import { getLogger } from '../utils/logger';

const logger = getLogger('table-view:rendered-link-navigation');

function getEventTargetElement(target: EventTarget | null): Element | null {
	if (target instanceof Element) {
		return target;
	}
	if (target instanceof Node) {
		return target.parentElement;
	}
	return null;
}

export function findRenderedLinkElement(target: EventTarget | null): HTMLElement | null {
	const element = getEventTargetElement(target);
	if (!element) {
		return null;
	}
	const link = element.closest('a, .internal-link, .external-link, [data-href]');
	const HTMLElementCtor = element.ownerDocument.defaultView?.HTMLElement;
	return HTMLElementCtor && link instanceof HTMLElementCtor ? link : null;
}

export function tryOpenRenderedInternalLink(
	app: App,
	sourcePath: string,
	event: MouseEvent
): boolean {
	const linkEl = findRenderedLinkElement(event.target);
	if (!linkEl) {
		return false;
	}

	const dataHref = linkEl.getAttribute('data-href')?.trim() ?? '';
	const href = linkEl.getAttribute('href')?.trim() ?? '';
	const target = dataHref || href;

	if (!target) {
		return false;
	}

	const targetType = classifyLinkTarget(target);
	if (targetType === 'external') {
		return false;
	}
	if (targetType === 'blocked') {
		event.preventDefault();
		event.stopPropagation();
		logger.warn('Blocked unsafe rendered link protocol', { target });
		return true;
	}

	event.preventDefault();
	event.stopPropagation();
	void app.workspace.openLinkText(target, sourcePath, true);
	return true;
}
