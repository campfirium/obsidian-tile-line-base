import { App, MarkdownView, Plugin } from 'obsidian';
import type { Editor, MarkdownFileInfo } from 'obsidian';
import {
	isCollapsedDataLine,
	parseCollapsedDataLine,
	parseCollapsedCommentSource,
	buildCollapsedSummary
} from '../table-view/collapsed/CollapsedFieldCodec';

interface HiddenFieldLineInfo {
	lineNumber: number;
	summary: string;
	collapsed: boolean;
}

interface ViewState {
	lines: Map<number, HiddenFieldLineInfo>;
	observer: MutationObserver | null;
	rootClickHandler: ((event: MouseEvent) => void) | null;
	rootKeyHandler: ((event: KeyboardEvent) => void) | null;
}

export class EditorHiddenFieldsController {
	private viewStates = new WeakMap<MarkdownView, ViewState>();
	private pendingProcess = new WeakMap<MarkdownView, number>();

	constructor(private readonly app: App) {}

	start(plugin: Plugin): void {
		const syncActive = () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			this.collapseAllLines(view);
			this.processMarkdownView(view);
		};

		plugin.registerEvent(this.app.workspace.on('active-leaf-change', syncActive));
		plugin.registerEvent(this.app.workspace.on('file-open', syncActive));
		plugin.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				const view = info instanceof MarkdownView ? info : this.findViewFromInfo(info);
				if (view) {
					this.collapseAllLines(view);
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

	private collapseAllLines(view: MarkdownView): void {
		const state = this.viewStates.get(view);
		if (!state) {
			return;
		}
		for (const lineInfo of state.lines.values()) {
			lineInfo.collapsed = true;
		}
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

		const hiddenLines = this.findHiddenFieldLines(editor.getValue());
		if (hiddenLines.size === 0) {
			this.detachView(view);
			return;
		}

		const state = this.ensureState(view, hiddenLines);
		this.decorateRoot(view);
		this.ensureObserver(view, state);
		this.tagExistingLines(view, state);
		this.ensureInteractions(view, state);
	}

	private decorateRoot(view: MarkdownView): void {
		const root = this.getSourceRoot(view);
		if (!root) {
			return;
		}
		root.classList.add('tlb-has-hidden-fields');
	}

	private ensureState(view: MarkdownView, hiddenLines: Map<number, HiddenFieldLineInfo>): ViewState {
		let state = this.viewStates.get(view);
		if (!state) {
			state = {
				lines: hiddenLines,
				observer: null,
				rootClickHandler: null,
				rootKeyHandler: null
			};
			this.viewStates.set(view, state);
			return state;
		}

		// Preserve user-expanded state when updating
		const preservedStates = new Map<number, boolean>();
		for (const [lineNum, lineInfo] of state.lines.entries()) {
			if (!lineInfo.collapsed) {
				preservedStates.set(lineNum, false);
			}
		}

		state.lines = hiddenLines;
		for (const [lineNum, expanded] of preservedStates.entries()) {
			const lineInfo = state.lines.get(lineNum);
			if (lineInfo) {
				lineInfo.collapsed = !expanded;
			}
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

		if (root) {
			if (state.rootClickHandler) {
				root.removeEventListener('click', state.rootClickHandler, true);
				state.rootClickHandler = null;
			}
			if (state.rootKeyHandler) {
				root.removeEventListener('keydown', state.rootKeyHandler, true);
				state.rootKeyHandler = null;
			}
			root.classList.remove('tlb-has-hidden-fields');
			root.querySelectorAll<HTMLElement>('.tlb-hidden-field-line').forEach((line) => {
				line.classList.remove('tlb-hidden-field-line');
				delete line.dataset.tlbHiddenSummary;
				delete line.dataset.tlbHiddenState;
				const content = line.querySelector<HTMLElement>('.cm-lineContent');
				content?.querySelectorAll('.tlb-hidden-field-toggle').forEach((toggle) => toggle.remove());
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
					window.requestAnimationFrame(() => {
						this.tagExistingLines(view, state);
					});
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

				const toggle = target.closest('.tlb-hidden-field-toggle');
				if (toggle) {
					event.preventDefault();
					const line = toggle.closest('.tlb-hidden-field-line') as HTMLElement | null;
					if (line) {
						this.toggleLine(view, state, line);
					}
					return;
				}

				const fieldLine = target.closest('.tlb-hidden-field-line') as HTMLElement | null;
				if (fieldLine) {
					event.preventDefault();
					this.toggleLine(view, state, fieldLine);
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
				if (!target.closest('.tlb-hidden-field-toggle')) {
					return;
				}
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					const line = target.closest('.tlb-hidden-field-line') as HTMLElement | null;
					if (line) {
						this.toggleLine(view, state, line);
					}
				}
			};
			root.addEventListener('keydown', handler, true);
			state.rootKeyHandler = handler;
		}
	}

	private toggleLine(view: MarkdownView, state: ViewState, lineEl: HTMLElement): void {
		const lineNumber = this.getLineNumber(view, lineEl);
		if (lineNumber === null) {
			return;
		}

		const lineInfo = state.lines.get(lineNumber);
		if (!lineInfo) {
			return;
		}

		lineInfo.collapsed = !lineInfo.collapsed;
		this.applyLineDecoration(lineEl, lineInfo);
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
		const lineNumber = this.getLineNumber(view, lineEl);
		if (lineNumber === null) {
			return;
		}

		const lineInfo = state.lines.get(lineNumber);
		const wasHiddenLine = lineEl.classList.contains('tlb-hidden-field-line');

		if (lineInfo) {
			this.applyLineDecoration(lineEl, lineInfo);
		} else if (wasHiddenLine) {
			lineEl.classList.remove('tlb-hidden-field-line');
			delete lineEl.dataset.tlbHiddenSummary;
			delete lineEl.dataset.tlbHiddenState;
			lineEl.removeAttribute('aria-expanded');
			lineEl.removeAttribute('aria-label');
			lineEl.removeAttribute('title');
			lineEl.removeAttribute('role');
			const contentEl = lineEl.querySelector<HTMLElement>('.cm-lineContent');
			contentEl?.classList.remove('tlb-hidden-field-callout-content');
			contentEl?.querySelectorAll('.tlb-hidden-field-toggle').forEach((toggle) => toggle.remove());
			contentEl?.querySelectorAll('.tlb-hidden-field-summary').forEach((node) => node.remove());
		}
	}

	private applyLineDecoration(lineEl: HTMLElement, lineInfo: HiddenFieldLineInfo): void {
		const contentEl = lineEl.querySelector<HTMLElement>('.cm-lineContent');
		if (!contentEl) {
			return;
		}

		lineEl.classList.add('tlb-hidden-field-line');
		lineEl.dataset.tlbHiddenSummary = lineInfo.summary;
		lineEl.dataset.tlbHiddenState = lineInfo.collapsed ? 'collapsed' : 'expanded';
		lineEl.setAttribute('aria-expanded', lineInfo.collapsed ? 'false' : 'true');
		lineEl.setAttribute('role', 'group');
		if (lineInfo.collapsed) {
			lineEl.setAttribute('aria-label', lineInfo.summary);
			lineEl.setAttribute('title', lineInfo.summary);
		} else {
			lineEl.removeAttribute('aria-label');
			lineEl.removeAttribute('title');
		}

		this.ensureSummary(contentEl, lineInfo.summary, lineInfo.collapsed);
		this.ensureToggle(contentEl, lineInfo.collapsed);
	}

	private ensureToggle(contentEl: HTMLElement, collapsed: boolean): void {
		let toggle = contentEl.querySelector<HTMLElement>('.tlb-hidden-field-toggle');
		if (!toggle) {
			toggle = document.createElement('span');
			toggle.className = 'tlb-hidden-field-toggle';
			toggle.tabIndex = 0;
			toggle.setAttribute('role', 'button');
			toggle.setAttribute('aria-label', 'Toggle hidden field');
			contentEl.appendChild(toggle);
		}
		toggle.setAttribute('data-state', collapsed ? 'collapsed' : 'expanded');
		toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
		toggle.setAttribute('title', collapsed ? 'Expand hidden fields' : 'Collapse hidden fields');
	}

	private ensureSummary(contentEl: HTMLElement, summary: string, collapsed: boolean): void {
		let summaryEl = contentEl.querySelector<HTMLElement>('.tlb-hidden-field-summary');
		if (!collapsed) {
			summaryEl?.remove();
			contentEl.classList.remove('tlb-hidden-field-callout-content');
			return;
		}

		contentEl.classList.add('tlb-hidden-field-callout-content');

		if (!summaryEl) {
			summaryEl = document.createElement('span');
			summaryEl.className = 'tlb-hidden-field-summary';
			summaryEl.setAttribute('aria-hidden', 'true');
			contentEl.insertBefore(summaryEl, contentEl.firstChild);
		}

		summaryEl.textContent = summary;
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

	private findHiddenFieldLines(content: string): Map<number, HiddenFieldLineInfo> {
		const lines = content.split(/\r?\n/);
		const hiddenLines = new Map<number, HiddenFieldLineInfo>();

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			const commentEntries = parseCollapsedCommentSource(line);
			if (commentEntries.length > 0) {
				const summary = buildCollapsedSummary(commentEntries);
				hiddenLines.set(index, {
					lineNumber: index,
					summary,
					collapsed: true
				});
				continue;
			}
			if (isCollapsedDataLine(line)) {
				const entries = parseCollapsedDataLine(line);
				const summary = buildCollapsedSummary(entries);
				hiddenLines.set(index, {
					lineNumber: index,
					summary,
					collapsed: true
				});
			}
		}

		return hiddenLines;
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
