import type { App } from 'obsidian';

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
	return link instanceof HTMLElement ? link : null;
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

	if (!target || isExternalTarget(target)) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	void app.workspace.openLinkText(target, sourcePath, true);
	return true;
}

function isExternalTarget(target: string): boolean {
	if (/^obsidian:\/\//i.test(target)) {
		return false;
	}
	if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
		return true;
	}
	if (/^[a-z][a-z\d+\-.]*:\/\//i.test(target)) {
		return true;
	}
	if (/^[a-z][a-z\d+\-.]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
		return true;
	}
	return false;
}
