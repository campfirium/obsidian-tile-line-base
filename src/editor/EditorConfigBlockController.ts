import { App, MarkdownView, Plugin } from 'obsidian';
import type { Editor, MarkdownFileInfo } from 'obsidian';

const CALLOUT_LINE_PATTERN = /^\s*>\s*\[!tlb-config]/i;
const INLINE_COMMENT_PATTERN = /<!--\s*tlb\.config\s*[:\uFF1A]/i;
const COMMENT_LINE_PATTERN = /^\s*<!--\s*tlb\.config\s*[:\uFF1A]/i;
const HEADING_LABEL_PATTERN = /^\s*>\s*\[!tlb-config]\s*-\s*([^<\r\n]*?)(?:(?:\s*<!--)|$)/i;

interface ConfigCalloutInfo {
	calloutLine: number;
	commentLine: number | null;
	headingLabel: string;
}

interface ViewState {
	info: ConfigCalloutInfo;
	collapsed: boolean;
	observer: MutationObserver | null;
	rootClickHandler: ((event: MouseEvent) => void) | null;
	rootKeyHandler: ((event: KeyboardEvent) => void) | null;
}

export class EditorConfigBlockController {
	private viewStates = new WeakMap<MarkdownView, ViewState>();
	private pendingProcess = new WeakMap<MarkdownView, number>();

	constructor(private readonly app: App) {}

	start(plugin: Plugin): void {
		const syncActive = () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				return;
			}
			const state = this.viewStates.get(view);
			if (state) {
				state.collapsed = true;
			}
			this.processMarkdownView(view);
		};

		plugin.registerEvent(this.app.workspace.on('active-leaf-change', syncActive));
		plugin.registerEvent(this.app.workspace.on('file-open', syncActive));
		plugin.registerEvent(this.app.workspace.on('layout-change', syncActive));
		plugin.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				const view = info instanceof MarkdownView ? info : this.findViewFromInfo(info);
				if (!view) {
					return;
				}
				const state = this.viewStates.get(view);
				if (state && !state.collapsed) {
					state.collapsed = true;
				}
				this.scheduleProcess(view);
			})
		);

		syncActive();
	}

	dispose(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				this.detachView(view);
			}
		});
		this.viewStates = new WeakMap();
		this.pendingProcess = new WeakMap();
	}

	private scheduleProcess(view: MarkdownView): void {
		const existing = this.pendingProcess.get(view);
		if (existing !== undefined) {
			window.clearTimeout(existing);
		}
		const handle = window.setTimeout(() => {
			this.pendingProcess.delete(view);
			this.processMarkdownView(view);
		}, 200);
		this.pendingProcess.set(view, handle);
	}

	private processMarkdownView(view: MarkdownView | null): void {
		if (!view || view.getMode() !== 'source') {
			if (view) {
				this.detachView(view);
			}
			return;
		}

		const editor = view.editor;
		if (!editor) {
			return;
		}

		const info = this.findConfigCallout(editor.getValue());
		if (!info) {
			this.detachView(view);
			return;
		}

		const state = this.ensureState(view, info);
		this.decorateRoot(view, state);
		this.ensureObserver(view, state);
		this.tagExistingLines(view, state);
		this.ensureInteractions(view, state);
		this.applyCollapsedState(view, state);
	}

	private ensureState(view: MarkdownView, info: ConfigCalloutInfo): ViewState {
		let state = this.viewStates.get(view);
		if (!state) {
			state = {
				info,
				collapsed: true,
				observer: null,
				rootClickHandler: null,
				rootKeyHandler: null
			};
			this.viewStates.set(view, state);
			return state;
		}

		const infoChanged =
			state.info.calloutLine !== info.calloutLine ||
			state.info.commentLine !== info.commentLine ||
			state.info.headingLabel !== info.headingLabel;
		if (infoChanged) {
			state.info = info;
			state.collapsed = true;
		}

		return state;
	}

	private decorateRoot(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		root.classList.add('tlb-has-config-block');
		root.dataset.tlbConfigHeading = state.info.headingLabel;
	}

	private ensureObserver(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root || state.observer) {
			return;
		}
		const observer = new MutationObserver(() => {
			this.tagExistingLines(view, state);
			this.applyCollapsedState(view, state);
		});
		observer.observe(root, { childList: true, subtree: true });
		state.observer = observer;
	}

	private ensureInteractions(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		if (!state.rootClickHandler) {
			state.rootClickHandler = (event) => this.handleRootClick(event, view, state);
			root.addEventListener('click', state.rootClickHandler, true);
		}
		if (!state.rootKeyHandler) {
			state.rootKeyHandler = (event) => this.handleRootKey(event, view, state);
			root.addEventListener('keydown', state.rootKeyHandler, true);
		}
	}

	private handleRootClick(event: MouseEvent, view: MarkdownView, state: ViewState): void {
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) {
			return;
		}
		const toggle = target.closest<HTMLElement>('.tlb-config-heading-toggle');
		if (toggle) {
			event.preventDefault();
			event.stopPropagation();
			this.toggleCollapsed(view, state);
			return;
		}
		const headingLine = target.closest<HTMLElement>('.tlb-config-heading-line');
		if (headingLine) {
			event.preventDefault();
			this.toggleCollapsed(view, state);
		}
	}

	private handleRootKey(event: KeyboardEvent, view: MarkdownView, state: ViewState): void {
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) {
			return;
		}
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		if (
			target.closest('.tlb-config-heading-toggle') ||
			target.closest('.tlb-config-heading-line')
		) {
			event.preventDefault();
			this.toggleCollapsed(view, state);
		}
	}

	private toggleCollapsed(view: MarkdownView, state: ViewState, forced?: boolean): void {
		const nextCollapsed = typeof forced === 'boolean' ? forced : !state.collapsed;
		if (state.collapsed === nextCollapsed) {
			return;
		}
		state.collapsed = nextCollapsed;
		this.applyCollapsedState(view, state);
	}

	private applyCollapsedState(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		root.dataset.tlbConfigState = state.collapsed ? 'collapsed' : 'expanded';
		this.updateHeadingToggleState(root, state.collapsed);
	}

	private updateHeadingToggleState(root: HTMLElement, collapsed: boolean): void {
		root.querySelectorAll<HTMLElement>('.tlb-config-heading-toggle').forEach((toggle) => {
			toggle.setAttribute('data-state', collapsed ? 'collapsed' : 'expanded');
			toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
		});
	}

	private tagExistingLines(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		root.querySelectorAll<HTMLElement>('.cm-line').forEach((lineEl) => {
			this.applyLineDecorations(view, state, lineEl);
		});
	}

	private applyLineDecorations(view: MarkdownView, state: ViewState, lineEl: HTMLElement): void {
		const lineNumber = this.getLineNumber(view, lineEl);
		if (lineNumber === null) {
			return;
		}
		const contentEl = lineEl.querySelector<HTMLElement>('.cm-lineContent');
		const isHeadingLine = lineNumber === state.info.calloutLine;
		const isCommentLine = !isHeadingLine && state.info.commentLine === lineNumber;

		if (isHeadingLine) {
			lineEl.classList.add('tlb-config-heading-line', 'tlb-config-line');
			lineEl.dataset.tlbHeading = state.info.headingLabel;
			if (contentEl) {
				contentEl.classList.add('tlb-config-heading-content');
				contentEl.dataset.tlbHeading = state.info.headingLabel;
				this.ensureHeadingToggle(contentEl);
			}
		} else {
			if (lineEl.classList.contains('tlb-config-heading-line')) {
				lineEl.classList.remove('tlb-config-heading-line');
				delete lineEl.dataset.tlbHeading;
			}
			lineEl.classList.remove('tlb-config-line');
			if (contentEl) {
				if (contentEl.classList.contains('tlb-config-heading-content')) {
					contentEl.classList.remove('tlb-config-heading-content');
					delete contentEl.dataset.tlbHeading;
					contentEl.querySelectorAll('.tlb-config-heading-toggle').forEach((toggle) => toggle.remove());
				}
			}
		}

		if (isCommentLine) {
			lineEl.classList.add('tlb-config-line');
		}
	}

	private ensureHeadingToggle(contentEl: HTMLElement): void {
		let toggle = contentEl.querySelector<HTMLElement>('.tlb-config-heading-toggle');
		if (!toggle) {
			toggle = document.createElement('span');
			toggle.className = 'tlb-config-heading-toggle';
			toggle.tabIndex = 0;
			toggle.setAttribute('role', 'button');
			toggle.setAttribute('aria-label', 'Toggle TLB config block');
			contentEl.appendChild(toggle);
		}
		const root = contentEl.closest<HTMLElement>('.markdown-source-view');
		const collapsed = root?.dataset.tlbConfigState !== 'expanded';
		toggle.setAttribute('data-state', collapsed ? 'collapsed' : 'expanded');
		toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
	}

	private detachView(view: MarkdownView): void {
		const state = this.viewStates.get(view);
		if (!state) {
			return;
		}
		const root = this.getSourceRoot(view);

		if (state.observer) {
			state.observer.disconnect();
			state.observer = null;
		}

		if (root) {
			if (state.rootClickHandler) {
				root.removeEventListener('click', state.rootClickHandler, true);
				state.rootClickHandler = null;
			}
			if (state.rootKeyHandler) {
				root.removeEventListener('keydown', state.rootKeyHandler, true);
				state.rootKeyHandler = null;
			}
			root.classList.remove('tlb-has-config-block');
			delete root.dataset.tlbConfigHeading;
			delete root.dataset.tlbConfigState;
			root.querySelectorAll<HTMLElement>('.tlb-config-heading-line, .tlb-config-line').forEach((line) => {
				line.classList.remove('tlb-config-heading-line', 'tlb-config-line');
				delete line.dataset.tlbHeading;
				const content = line.querySelector<HTMLElement>('.cm-lineContent');
				if (content) {
					content.classList.remove('tlb-config-heading-content');
					delete content.dataset.tlbHeading;
					content.querySelectorAll('.tlb-config-heading-toggle').forEach((toggle) => toggle.remove());
				}
			});
		}

		this.viewStates.delete(view);
	}

	private findConfigCallout(content: string): ConfigCalloutInfo | null {
		const lines = content.split(/\r?\n/);
		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index];
			if (!CALLOUT_LINE_PATTERN.test(line)) {
				continue;
			}
			const headingLabel = this.extractHeadingLabel(line);
			let commentLine: number | null = null;
			if (INLINE_COMMENT_PATTERN.test(line)) {
				commentLine = index;
			} else if (index + 1 < lines.length && COMMENT_LINE_PATTERN.test(lines[index + 1])) {
				commentLine = index + 1;
			}
			return {
				calloutLine: index,
				commentLine,
				headingLabel
			};
		}
		return null;
	}

	private extractHeadingLabel(line: string): string {
		const match = line.match(HEADING_LABEL_PATTERN);
		const raw = match?.[1]?.trim() ?? '';
		return raw.length > 0 ? raw : 'TLB config block';
	}

	private getSourceRoot(view: MarkdownView): HTMLElement | null {
		return view.containerEl.querySelector('.markdown-source-view');
	}

	private getLineNumber(view: MarkdownView, lineEl: HTMLElement): number | null {
		const editor = view.editor;
		const cm = (editor as any)?.cm;
		if (!cm?.state?.doc) {
			return null;
		}
		try {
			const pos = cm.posAtDOM(lineEl, 0);
			if (typeof pos !== 'number') {
				return null;
			}
			return cm.state.doc.lineAt(pos).number - 1;
		} catch {
			return null;
		}
	}

	private findViewFromInfo(info: MarkdownFileInfo | undefined): MarkdownView | null {
		if (!info) {
			return null;
		}
		if (info instanceof MarkdownView) {
			return info;
		}
		if ('editor' in info && info.editor) {
			return this.findViewByEditor(info.editor);
		}
		return null;
	}

	private findViewByEditor(editor: Editor): MarkdownView | null {
		let found: MarkdownView | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found) {
				return;
			}
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor === editor) {
				found = view;
			}
		});
		return found;
	}
}
