import { App, Modal } from 'obsidian';

export interface MagicMigrationPreview {
	columns: string[];
	rows: string[][];
	error: string | null;
	matchCount: number;
	truncated: boolean;
}

interface MagicMigrationModalOptions {
	initialTemplate: string;
	initialSample: string;
	targetFileName: string;
	initialColumns: string[];
	sourceContent: string;
	computePreview: (template: string, sample: string, columnNames: string[]) => MagicMigrationPreview;
	onSubmit: (template: string, sample: string, columnNames: string[]) => Promise<boolean>;
	onClose: (latestTemplate: string, latestSample: string, latestColumns: string[]) => void;
}

type WizardViewMode = 'source' | 'preview';
const DEFAULT_COLUMN_BASE = 'Column';

export class MagicMigrationModal extends Modal {
	private readonly options: MagicMigrationModalOptions;
	private templateValue: string;
	private sampleValue: string;
	private columnNames: string[];
	private preview: MagicMigrationPreview;
	private previewContainer: HTMLElement | null = null;
	private previewStatusEl: HTMLElement | null = null;
	private previewSummaryEl: HTMLElement | null = null;
	private previewHintEl: HTMLElement | null = null;
	private previewFootnoteEl: HTMLElement | null = null;
	private sourcePane: HTMLElement | null = null;
	private previewPane: HTMLElement | null = null;
	private sourceContentEl: HTMLElement | null = null;
	private convertButton: HTMLButtonElement | null = null;
	private sampleInput: HTMLTextAreaElement | null = null;
	private templateInput: HTMLTextAreaElement | null = null;
	private selectionChangeCleanup: (() => void) | null = null;
	private isSubmitting = false;
	private returnFocusTarget: HTMLElement | null = null;
	private keydownHandler?: (event: KeyboardEvent) => void;

	constructor(app: App, options: MagicMigrationModalOptions) {
		super(app);
		this.options = options;
		this.templateValue = options.initialTemplate;
		this.sampleValue = options.initialSample;
		this.columnNames = options.initialColumns.slice();
		this.preview = options.computePreview(this.templateValue, this.sampleValue, this.columnNames);
		this.syncColumnNamesFromPreview();
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		const ownerDoc = contentEl.ownerDocument ?? document;
		const activeElement = ownerDoc.activeElement;
		if (activeElement instanceof HTMLElement) {
			this.returnFocusTarget = activeElement;
		}

		contentEl.empty();
		this.modalEl?.addClass('tlb-conversion-modal');
		contentEl.addClass('tlb-magic-migration-modal');
		contentEl.addClass('tlb-conversion-wizard');

		this.renderLayout(ownerDoc);
		this.refreshPreview();
		this.setActiveView('source');
		this.syncConvertButton();
		this.focusSample(ownerDoc);
		this.attachSelectionWatcher(ownerDoc);

		if (modalEl) {
			this.keydownHandler = (event: KeyboardEvent) => {
				if (event.key === 'Escape' || event.key === 'Esc') {
					event.preventDefault();
					event.stopPropagation();
					this.close();
				}
			};
			modalEl.addEventListener('keydown', this.keydownHandler, true);
		}
	}

	onClose(): void {
		if (this.modalEl && this.keydownHandler) {
			this.modalEl.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = undefined;
		}
		if (this.selectionChangeCleanup) {
			this.selectionChangeCleanup();
			this.selectionChangeCleanup = null;
		}
		this.options.onClose(this.templateValue, this.sampleValue, this.getNormalizedColumnNames());
		if (this.returnFocusTarget && this.returnFocusTarget.isConnected) {
			this.returnFocusTarget.focus({ preventScroll: true });
		}
		this.returnFocusTarget = null;
	}

	private async handleSubmit(): Promise<void> {
		if (this.isSubmitting || this.preview.error || this.preview.rows.length === 0) {
			return;
		}
		this.isSubmitting = true;
		this.syncConvertButton();
		try {
			const success = await this.options.onSubmit(
				this.templateValue,
				this.sampleValue,
				this.getNormalizedColumnNames()
			);
			if (success) {
				this.close();
			} else {
				this.isSubmitting = false;
				this.syncConvertButton();
			}
		} catch (error) {
			this.isSubmitting = false;
			this.syncConvertButton();
			console.error('[MagicMigrationModal] submit failed', error);
		}
	}

	private renderLayout(ownerDoc: Document): void {
		this.titleEl.setText('Conversion Wizard');
		const shell = this.contentEl.createDiv({ cls: 'tlb-conversion-layout' });
		const left = shell.createDiv({ cls: 'tlb-conversion-left' });
		const right = shell.createDiv({ cls: 'tlb-conversion-right' });

		const header = left.createDiv({ cls: 'tlb-conversion-header' });
		header.createEl('h2', { text: 'Conversion Wizard' });
		header.createEl('p', {
			text: 'Extract data from text to create a structured note.',
			cls: 'tlb-conversion-subtitle'
		});
		header.createEl('div', {
			text: `Target: ${this.options.targetFileName}`,
			cls: 'tlb-conversion-target'
		});

		const formArea = left.createDiv({ cls: 'tlb-conversion-left-body' });

		const fieldRow = formArea.createDiv({ cls: 'tlb-conversion-field-row' });

		this.sampleInput = this.createTextareaField(fieldRow, ownerDoc, {
			label: 'Sample Row',
			helper: 'Select text from the Source Text panel. The selection represents one row of data in your table.',
			value: this.sampleValue,
			rows: 4,
			onInput: (value) => {
				this.sampleValue = value;
				this.refreshPreview();
			},
			onFocus: () => this.setActiveView('source'),
			wrapperClass: 'tlb-conversion-field--half',
			actionSlot: (slot) => {
				const button = slot.createEl('button', { cls: 'tlb-conversion-aux-button', text: 'Select from Source' });
				button.addEventListener('click', () => {
					this.applySelectionFromSource();
				});
			},
			placeholder: 'Select text from the Source Text panel.'
		});

		this.templateInput = this.createTextareaField(fieldRow, ownerDoc, {
			label: 'Extraction Pattern',
			helper: 'Replace the content you want to extract (or that varies) with an asterisk *.',
			value: this.templateValue,
			rows: 6,
			onInput: (value) => {
				this.templateValue = value;
				this.refreshPreview();
			},
			onFocus: () => this.setActiveView('preview'),
			wrapperClass: 'tlb-conversion-field--half',
			placeholder: 'Use * to capture variable content.'
		});

		this.previewPane = this.renderPreviewPane(formArea);

		const actions = left.createDiv({ cls: 'tlb-conversion-actions' });
		const cancelButton = actions.createEl('button', { text: 'Cancel', cls: 'tlb-conversion-button' });
		cancelButton.addEventListener('click', () => this.close());
		const submitButton = actions.createEl('button', {
			text: 'Create Note',
			cls: 'tlb-conversion-button tlb-conversion-button--primary mod-cta'
		});
		submitButton.addEventListener('click', () => {
			void this.handleSubmit();
		});
		this.convertButton = submitButton;

		this.sourcePane = this.renderSourcePane(right, ownerDoc);
	}

	private createTextareaField(
		container: HTMLElement,
		ownerDoc: Document,
		options: {
			label: string;
			helper: string;
			value: string;
			rows: number;
			onInput: (value: string) => void;
			onFocus: () => void;
			wrapperClass?: string;
			placeholder?: string;
			actionSlot?: (container: HTMLElement) => void;
		}
	): HTMLTextAreaElement {
		const wrapper = container.createDiv({ cls: 'tlb-conversion-field tlb-conversion-field--fixed' });
		if (options.wrapperClass) {
			wrapper.addClass(options.wrapperClass);
		}
		const labelRow = wrapper.createDiv({ cls: 'tlb-conversion-label-row' });
		labelRow.createEl('label', { text: options.label, cls: 'tlb-conversion-label' });
		const actions = wrapper.createDiv({ cls: 'tlb-conversion-field__actions' });
		if (options.actionSlot) {
			options.actionSlot(actions);
		}
		wrapper.createEl('div', { text: options.helper, cls: 'tlb-conversion-helper' });
		const textarea = ownerDoc.createElement('textarea');
		textarea.value = options.value;
		textarea.rows = options.rows;
		textarea.className = 'tlb-conversion-textarea tlb-conversion-textarea--fixed';
		if (options.placeholder) {
			textarea.placeholder = options.placeholder;
		}
		textarea.addEventListener('input', () => options.onInput(textarea.value));
		textarea.addEventListener('focus', () => options.onFocus());
		wrapper.appendChild(textarea);
		return textarea;
	}

	private renderSourcePane(container: HTMLElement, ownerDoc: Document): HTMLElement {
		const pane = container.createDiv({ cls: 'tlb-conversion-pane tlb-conversion-pane--source' });
		pane.createDiv({ cls: 'tlb-conversion-pane-title', text: 'Source Text' });
		pane.createDiv({
			cls: 'tlb-conversion-tip',
			text: 'Highlight a representative line of text. It will be copied to the Sample panel.'
		});
		const sourceBox = pane.createDiv({ cls: 'tlb-conversion-source' });
		const content = ownerDoc.createElement('pre');
		content.tabIndex = 0;
		content.className = 'tlb-conversion-source__content';
		const sourceText = this.options.sourceContent?.trim();
		content.textContent = sourceText && sourceText.length > 0
			? this.options.sourceContent
			: 'Highlight a representative line of text here to start.';
		content.addEventListener('mouseup', () => this.handleSourceSelection());
		content.addEventListener('keyup', () => this.handleSourceSelection());
		sourceBox.appendChild(content);
		this.sourceContentEl = content;
		return pane;
	}

	private renderPreviewPane(container: HTMLElement): HTMLElement {
		const pane = container.createDiv({ cls: 'tlb-conversion-pane tlb-conversion-pane--preview is-active' });
		pane.createDiv({ cls: 'tlb-conversion-pane-title', text: 'Preview Results' });
		const statusRow = pane.createDiv({ cls: 'tlb-conversion-status' });
		this.previewSummaryEl = statusRow.createSpan({ cls: 'tlb-conversion-status__summary' });
		statusRow.createSpan({ text: ' ' });
		this.previewHintEl = statusRow.createSpan({ cls: 'tlb-conversion-status__hint' });
		this.previewStatusEl = statusRow;
		this.previewContainer = pane.createDiv({ cls: 'tlb-conversion-preview' });
		this.previewFootnoteEl = pane.createDiv({
			cls: 'tlb-conversion-footnote',
			text: '💡 Click table headers to rename columns.'
		});
		return pane;
	}

	private refreshPreview(): void {
		this.preview = this.options.computePreview(
			this.templateValue,
			this.sampleValue,
			this.getNormalizedColumnNames()
		);
		this.syncColumnNamesFromPreview();
		this.renderPreview();
		this.syncConvertButton();
	}

	private setActiveView(_view: WizardViewMode): void {
		// Always keep source visible; preview remains active for stacked layout.
		this.sourcePane?.addClass('is-active');
		this.previewPane?.addClass('is-active');
	}

	private handleSourceSelection(): void {
		if (!this.sourceContentEl) {
			return;
		}
		const ownerDoc = this.sourceContentEl.ownerDocument ?? document;
		const selection = ownerDoc.getSelection();
		const anchorNode = selection?.anchorNode;
		if (!selection || selection.isCollapsed || !anchorNode || !this.sourceContentEl.contains(anchorNode)) {
			return;
		}
		const selected = selection.toString().trim();
		if (!selected) {
			return;
		}
		this.applySampleSelection(selected);
	}

	private applySampleSelection(selected: string): void {
		this.sampleValue = selected;
		if (this.sampleInput) {
			this.sampleInput.value = selected;
		}
		this.templateValue = selected;
		if (this.templateInput) {
			this.templateInput.value = selected;
		}
		this.refreshPreview();
	}

	private attachSelectionWatcher(ownerDoc: Document): void {
		if (this.selectionChangeCleanup) {
			return;
		}
		const handler = () => {
			if (!this.sourceContentEl) {
				return;
			}
			const selection = ownerDoc.getSelection();
			if (!selection || selection.isCollapsed) {
				return;
			}
			const anchorNode = selection.anchorNode;
			const focusNode = selection.focusNode;
			if (!anchorNode || !focusNode) {
				return;
			}
			if (!this.sourceContentEl.contains(anchorNode) || !this.sourceContentEl.contains(focusNode)) {
				return;
			}
			const text = selection.toString().trim();
			if (!text) {
				return;
			}
			this.applySampleSelection(text);
		};
		ownerDoc.addEventListener('selectionchange', handler);
		this.selectionChangeCleanup = () => ownerDoc.removeEventListener('selectionchange', handler);
	}

	private applySelectionFromSource(): void {
		if (!this.sourceContentEl) {
			return;
		}
		const ownerDoc = this.sourceContentEl.ownerDocument ?? document;
		const selection = ownerDoc.getSelection();
		const anchorNode = selection?.anchorNode;
		if (!selection || selection.isCollapsed || !anchorNode || !this.sourceContentEl.contains(anchorNode)) {
			return;
		}
		const text = selection.toString().trim();
		if (!text) {
			return;
		}
		this.applySampleSelection(text);
	}

	private renderPreview(): void {
		if (!this.previewContainer || !this.previewStatusEl) {
			return;
		}
		this.previewContainer.empty();
		const preview = this.preview;

		const summaryEl = this.previewSummaryEl;
		const hintEl = this.previewHintEl;

		if (preview.error) {
			if (summaryEl) summaryEl.setText(preview.error);
			if (hintEl) hintEl.setText('');
			return;
		}

		if (preview.rows.length === 0) {
			if (summaryEl) summaryEl.setText('No matches yet.');
			if (hintEl) hintEl.setText('Content that does not match the template will be ignored automatically.');
			return;
		}

		const countText = preview.truncated
			? `Found ${preview.rows.length} of ${preview.matchCount} matches.`
			: `Found ${preview.matchCount} matches.`;
		if (summaryEl) summaryEl.setText(countText);
		if (hintEl) hintEl.setText('Content that does not match the template will be ignored automatically.');

		const table = this.previewContainer.createEl('table', { cls: 'tlb-conversion-preview__table' });
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');
		for (let index = 0; index < this.columnNames.length; index++) {
			const th = headerRow.createEl('th');
			const input = th.createEl('input', {
				attr: { type: 'text' },
				cls: 'tlb-conversion-column-input'
			}) as HTMLInputElement;
			input.value = this.columnNames[index] ?? '';
			input.placeholder = `${DEFAULT_COLUMN_BASE} ${index + 1}`;
			input.addEventListener('input', () => {
				this.columnNames[index] = input.value;
			});
			input.addEventListener('blur', () => {
				this.columnNames[index] = input.value.trim() || `${DEFAULT_COLUMN_BASE} ${index + 1}`;
			});
		}

		const tbody = table.createEl('tbody');
		for (const row of preview.rows) {
			const tr = tbody.createEl('tr');
			for (let index = 0; index < this.columnNames.length; index++) {
				tr.createEl('td', { text: row[index] ?? '' });
			}
		}

		if (this.previewFootnoteEl) {
			this.previewFootnoteEl.setText('💡 Click table headers to rename columns.');
		}
	}

	private syncConvertButton(): void {
		if (!this.convertButton) {
			return;
		}
		const shouldDisable = this.isSubmitting || Boolean(this.preview.error) || this.preview.rows.length === 0;
		this.convertButton.toggleAttribute('disabled', shouldDisable);
		this.convertButton.classList.toggle('is-loading', this.isSubmitting);
	}

	private buildColumnNames(count: number): string[] {
		const names: string[] = [];
		const target = Math.max(count, 1);
		for (let index = 0; index < target; index++) {
			names.push(`${DEFAULT_COLUMN_BASE} ${index + 1}`);
		}
		return names;
	}

	private syncColumnNamesFromPreview(): void {
		const desired = Math.max(this.preview.columns.length, this.estimateColumnCount());
		const defaults = this.buildColumnNames(desired);
		const next: string[] = [];
		for (let index = 0; index < desired; index++) {
			const existing = (this.columnNames[index] ?? '').trim();
			const previewName = (this.preview.columns[index] ?? '').trim();
			next.push(existing || previewName || defaults[index]);
		}
		this.columnNames = next;
	}

	private estimateColumnCount(): number {
		const count = this.countPlaceholders(this.templateValue);
		return count > 0 ? count : 1;
	}

	private countPlaceholders(template: string): number {
		return (template.match(/\*/g) ?? []).length;
	}

	private getNormalizedColumnNames(): string[] {
		const desired = Math.max(this.preview.columns.length, this.estimateColumnCount());
		const defaults = this.buildColumnNames(desired);
		const normalized: string[] = [];
		for (let index = 0; index < desired; index++) {
			const value = (this.columnNames[index] ?? '').trim();
			normalized.push(value || defaults[index]);
		}
		return normalized;
	}

	private focusSample(ownerDoc: Document): void {
		const raf = ownerDoc.defaultView?.requestAnimationFrame ?? window.requestAnimationFrame;
		const focus = () => {
			if (this.sampleInput) {
				this.sampleInput.focus({ preventScroll: true });
				const end = this.sampleInput.value.length;
				this.sampleInput.setSelectionRange(end, end);
			}
		};
		if (typeof raf === 'function') {
			raf(() => focus());
		} else {
			window.setTimeout(() => focus(), 0);
		}
	}
}
