import { App, MarkdownView, Plugin } from 'obsidian';
import type { Editor, MarkdownFileInfo } from 'obsidian';
interface ConfigBlockInfo {
	headingLine: number;
	headingLabel: string;
	codeStartLine: number;
	codeEndLine: number;
}
interface ViewState {
	info: ConfigBlockInfo;
	collapsed: boolean;
	observer: MutationObserver | null;
	rootClickHandler: ((event: MouseEvent) => void) | null;
	rootKeyHandler: ((event: KeyboardEvent) => void) | null;
	collapseSyncHandle: number | null;
}

export class EditorConfigBlockController {
	private viewStates = new WeakMap<MarkdownView, ViewState>();
	private pendingProcess = new WeakMap<MarkdownView, number>();

	constructor(private readonly app: App) {}

		start(plugin: Plugin): void {
			const syncActive = () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return;
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
					if (view) {
						this.scheduleProcess(view);
					}
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
		}, 120);
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

		const block = this.findConfigBlock(editor.getValue());
		if (!block) {
			this.detachView(view);
			return;
		}

		const state = this.ensureState(view, block);
		this.decorateRoot(view, state);
		this.ensureObserver(view, state);
		this.tagExistingLines(view, state);
		this.ensureInteractions(view, state);
		this.applyCollapsedState(view, state);
	}

	private decorateRoot(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		root.classList.add('tlb-has-config-block');
		root.dataset.tlbConfigHeading = state.info.headingLabel;
	}

	private ensureState(view: MarkdownView, info: ConfigBlockInfo): ViewState {
		let state = this.viewStates.get(view);
		if (!state) {
			state = {
				info,
				collapsed: true,
				observer: null,
				rootClickHandler: null,
				rootKeyHandler: null,
				collapseSyncHandle: null
			};
			this.viewStates.set(view, state);
			return state;
		}

		const infoChanged =
			state.info.headingLine !== info.headingLine ||
			state.info.codeStartLine !== info.codeStartLine ||
			state.info.codeEndLine !== info.codeEndLine ||
			state.info.headingLabel !== info.headingLabel;

		state.info = info;
		if (infoChanged) {
			this.tagExistingLines(view, state);
		}
		return state;
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
		this.cancelCollapsedSync(state);

		if (root) {
			this.clearResolvedBackground(view);
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
			root.querySelectorAll<HTMLElement>('.tlb-config-heading-line').forEach((line) => {
				line.classList.remove('tlb-config-heading-line', 'tlb-config-line');
				line.removeAttribute('data-tlb-heading');
				const content = line.querySelector<HTMLElement>('.tlb-config-heading-content');
				content?.classList.remove('tlb-config-heading-content');
				content?.querySelectorAll('.tlb-config-heading-toggle').forEach((toggle) => toggle.remove());
			});
			root.querySelectorAll<HTMLElement>('.tlb-config-code-line').forEach((line) => {
				line.classList.remove('tlb-config-code-line', 'tlb-config-line');
			});
		}

		this.viewStates.delete(view);
	}

	private ensureObserver(view: MarkdownView, state: ViewState): void {
		if (state.observer) {
			return;
		}
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					this.tagExistingLines(view, state);
					if (state.collapsed) {
						this.scheduleCollapsedSync(view, state);
					}
					break;
				}
			}
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
			const handler = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target) {
				return;
			}
			const toggle = target.closest('.tlb-config-heading-toggle');
			if (toggle) {
				event.preventDefault();
				this.toggleCollapsedState(view, state);
				return;
			}
			if (target.closest('.tlb-config-heading-line')) {
				event.preventDefault();
				this.toggleCollapsedState(view, state);
			}
		};
		root.addEventListener('click', handler, true);
			state.rootClickHandler = handler;
		}

		if (!state.rootKeyHandler) {
			const handler = (event: KeyboardEvent) => {
				const target = event.target as HTMLElement | null;
				if (!target) {
					return;
				}
				if (!target.closest('.tlb-config-heading-toggle')) {
					return;
				}
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					this.toggleCollapsedState(view, state);
				}
			};
			root.addEventListener('keydown', handler, true);
			state.rootKeyHandler = handler;
		}
	}

	private toggleCollapsedState(view: MarkdownView, state: ViewState): void {
		state.collapsed = !state.collapsed;
		this.applyCollapsedState(view, state);
		if (!state.collapsed) {
			this.scrollToHeading(view);
		}
	}

	private applyCollapsedState(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		root.dataset.tlbConfigHeading = state.info.headingLabel;
		root.dataset.tlbConfigState = state.collapsed ? 'collapsed' : 'expanded';
		this.updateHeadingToggleState(root, state.collapsed);
		this.tagExistingLines(view, state);
		if (state.collapsed) {
			this.scheduleCollapsedSync(view, state);
		} else {
			this.cancelCollapsedSync(state);
			this.clearResolvedBackground(view);
		}
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
		root.querySelectorAll<HTMLElement>('.cm-line').forEach((line) => {
			this.applyLineDecorations(view, state, line);
		});
	}

	private applyLineDecorations(view: MarkdownView, state: ViewState, lineEl: HTMLElement): void {
		const contentEl = lineEl.querySelector<HTMLElement>('.cm-lineContent');
		const isHeadingLine = this.getLineNumber(view, lineEl) === state.info.headingLine;
		const isCodeLine = this.isCodeLine(view, lineEl, state.info);
		const wasHeadingLine = lineEl.classList.contains('tlb-config-heading-line');
		const wasCodeLine = lineEl.classList.contains('tlb-config-code-line');

		if (isHeadingLine) {
			lineEl.classList.add('tlb-config-heading-line', 'tlb-config-line');
			lineEl.dataset.tlbHeading = state.info.headingLabel;
			if (contentEl) {
				contentEl.classList.add('tlb-config-heading-content');
				contentEl.dataset.tlbHeading = state.info.headingLabel;
					this.ensureHeadingToggle(contentEl);
				}
			} else if (wasHeadingLine) {
				lineEl.classList.remove('tlb-config-heading-line', 'tlb-config-line');
				lineEl.removeAttribute('data-tlb-heading');
				contentEl?.classList.remove('tlb-config-heading-content');
			if (contentEl) {
				delete contentEl.dataset.tlbHeading;
			}
				contentEl?.querySelectorAll('.tlb-config-heading-toggle').forEach((toggle) => toggle.remove());
			}

		if (isCodeLine) {
			lineEl.classList.add('tlb-config-code-line', 'tlb-config-line');
		} else if (wasCodeLine) {
			lineEl.classList.remove('tlb-config-code-line', 'tlb-config-line');
		}
	}

	private scheduleCollapsedSync(view: MarkdownView, state: ViewState): void {
		if (state.collapseSyncHandle !== null) {
			return;
		}
		state.collapseSyncHandle = window.setTimeout(() => {
			state.collapseSyncHandle = null;
			if (!state.collapsed) {
				return;
			}
			window.requestAnimationFrame(() => {
				if (!state.collapsed) {
					return;
				}
				this.runCollapsedSync(view, state);
			});
		}, 16);
	}

	private cancelCollapsedSync(state: ViewState): void {
		if (state.collapseSyncHandle === null) {
			return;
		}
		window.clearTimeout(state.collapseSyncHandle);
		state.collapseSyncHandle = null;
	}

	private runCollapsedSync(view: MarkdownView, state: ViewState): void {
		const root = this.getSourceRoot(view);
		if (!root || !state.collapsed) {
			return;
		}
		this.tagExistingLines(view, state);
		this.updateHeadingToggleState(root, true);
		this.resolveConfigBackground(view);
	}

	private resolveConfigBackground(view: MarkdownView): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		const candidates = Array.from(
			root.querySelectorAll<HTMLElement>('.tlb-config-code-line, .tlb-config-code-line .cm-lineContent')
		);
		let background: string | null = null;
		for (const candidate of candidates) {
			const target = candidate.matches('.cm-lineContent') ? candidate : candidate.querySelector<HTMLElement>('.cm-lineContent') ?? candidate;
			const computed = window.getComputedStyle(target);
			const value = computed.backgroundColor;
			if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
				background = value;
				break;
			}
		}
		if (background) {
			root.style.setProperty('--tlb-config-card-background-resolved', background);
		} else {
			this.clearResolvedBackground(view);
		}
	}

	private clearResolvedBackground(view: MarkdownView): void {
		const root = this.getSourceRoot(view);
		root?.style.removeProperty('--tlb-config-card-background-resolved');
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

	private scrollToHeading(view: MarkdownView): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		const heading = root.querySelector<HTMLElement>('.tlb-config-heading-line');
		if (heading) {
			heading.scrollIntoView({ block: 'nearest' });
		}
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

	private isCodeLine(view: MarkdownView, lineEl: HTMLElement, info: ConfigBlockInfo): boolean {
		const lineNumber = this.getLineNumber(view, lineEl);
		if (lineNumber === null) {
			return false;
		}
		return info.codeStartLine !== -1 && info.codeEndLine !== -1 && lineNumber >= info.codeStartLine && lineNumber <= info.codeEndLine;
	}

	private findConfigBlock(content: string): ConfigBlockInfo | null {
		const lines = content.split(/\r?\n/);
		const headingPattern = /^##\s+tlb\s+\S+\s+\d+\s*$/i;
		const fenceStartPattern = /^```(?:tlb|tilelinebase)\b/i;

		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index].trim();
			if (!headingPattern.test(line)) {
				continue;
			}

			const codeStart = this.findCodeStart(lines, index + 1, fenceStartPattern);
			if (codeStart === -1) {
				continue;
			}

			const codeEnd = this.findCodeEnd(lines, codeStart + 1);
			if (codeEnd === -1) {
				continue;
			}

			return {
				headingLine: index,
				headingLabel: this.normalizeHeading(line),
				codeStartLine: codeStart,
				codeEndLine: codeEnd
			};
		}

		return null;
	}

	private findCodeStart(lines: string[], startIndex: number, pattern: RegExp): number {
		for (let i = startIndex; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (!trimmed) {
				continue;
			}
			if (pattern.test(trimmed)) {
				return i;
			}
			if (trimmed.startsWith('## ')) {
				return -1;
			}
		}
		return -1;
	}

	private findCodeEnd(lines: string[], startIndex: number): number {
		for (let i = startIndex; i < lines.length; i++) {
			if (lines[i].trim().startsWith('```')) {
				return i;
			}
		}
		return -1;
	}

	private normalizeHeading(raw: string): string {
		return raw.replace(/^##\s*/, '').trim();
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
