import { App, Component, MarkdownRenderer } from 'obsidian';
import type { ComputedLayout } from './slideLayout';

export function resetRenderArtifacts(renderCleanup: Array<() => void>, markdownComponents: Component[]): void {
	for (const dispose of renderCleanup) {
		try {
			dispose();
		} catch {
			// ignore
		}
	}
	renderCleanup.length = 0;
	for (const component of markdownComponents) {
		try {
			component.unload();
		} catch {
			// ignore
		}
	}
	markdownComponents.length = 0;
}

export function applyLayoutWithWatcher(
	renderCleanup: Array<() => void>,
	el: HTMLElement,
	layout: ComputedLayout,
	slideEl: HTMLElement,
	applyLayout: (el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement) => void
): void {
	applyLayout(el, layout, slideEl);
	if (typeof ResizeObserver === 'undefined') {
		return;
	}
	const observer = new ResizeObserver(() => applyLayout(el, layout, slideEl));
	observer.observe(el);
	renderCleanup.push(() => observer.disconnect());
}

export function buildSlideMarkdown(textBlocks: string[]): string {
	// Replace empty lines with explicit <br> so blank rows survive Markdown rendering.
	return textBlocks.map((line) => (line.trim().length === 0 ? '<br />' : line)).join('\n');
}

export function renderMarkdownBlock(
	app: App,
	markdown: string,
	container: HTMLElement,
	sourcePath: string,
	markdownComponents: Component[]
): void {
	const component = new Component();
	markdownComponents.push(component);
	void MarkdownRenderer.render(app, markdown, container, sourcePath, component).catch(() => {
		container.setText(markdown);
	});
}
