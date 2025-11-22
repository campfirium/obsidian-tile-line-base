import type { App } from 'obsidian';
import { Menu, Modal } from 'obsidian';
import { t } from '../../i18n';
import type { SlideTemplateConfig } from '../../types/slide';

interface SlideTemplateModalOptions {
	app: App;
	fields: string[];
	initial: SlideTemplateConfig;
	onSave: (next: SlideTemplateConfig) => void;
}

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

export class SlideTemplateModal extends Modal {
	private readonly fields: string[];
	private readonly onSave: (next: SlideTemplateConfig) => void;
	private titleTemplate: string;
	private bodyTemplate: string;
	private titleInputEl: HTMLTextAreaElement | null = null;
	private bodyInputEl: HTMLTextAreaElement | null = null;
	private insertButtonEl: HTMLButtonElement | null = null;
	private lastFocusedInput: HTMLTextAreaElement | null = null;

	constructor(opts: SlideTemplateModalOptions) {
		super(opts.app);
		this.fields = opts.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		this.onSave = opts.onSave;
		this.titleTemplate = opts.initial.titleTemplate ?? '';
		this.bodyTemplate = opts.initial.bodyTemplate ?? '';
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.addClass('tlb-slide-template');
		this.titleEl.setText(t('slideView.templateModal.title'));
		this.renderInsertRow();
		this.renderTitleInput();
		this.renderBodyInput();
		this.ensureBodyInputExists();
		this.renderActions();
	}

	onClose(): void {
		this.contentEl.empty();
		this.titleInputEl = null;
		this.bodyInputEl = null;
		this.insertButtonEl = null;
		this.lastFocusedInput = null;
	}

	private renderInsertRow(): void {
		const header = this.contentEl.createDiv({ cls: 'tlb-slide-template__header' });
		const insertButton = header.createEl('button', {
			cls: 'tlb-slide-template__insert',
			text: t('slideView.templateModal.insertField'),
			attr: { type: 'button' }
		});
		this.insertButtonEl = insertButton;
		insertButton.disabled = false;
		insertButton.addEventListener('mousedown', (event) => {
			// Preserve textarea focus so insertion target stays accurate.
			event.preventDefault();
		});
		insertButton.addEventListener('click', (event) => {
			event.preventDefault();
			const menu = new Menu();
			if (this.fields.length === 0) {
				menu.addItem((item) => {
					item.setTitle(t('kanbanView.content.noFieldOption'));
					item.setDisabled(true);
				});
				menu.showAtMouseEvent(event);
				return;
			}
			for (const field of this.fields) {
				menu.addItem((item) => {
					item.setTitle(field);
					item.onClick(() => {
						const target = this.resolveInsertionTarget();
						if (!target) {
							return;
						}
						this.insertPlaceholder(target, `{${field}}`);
					});
				});
			}
			menu.showAtMouseEvent(event);
		});
		this.refreshInsertButton();
	}

	private renderTitleInput(): void {
		const block = this.contentEl.createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.titleFieldLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.titleFieldDesc') });
		const input = block.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--title',
			attr: {
				rows: '2',
				placeholder: t('slideView.templateModal.titleFieldDesc')
			}
		}) as HTMLTextAreaElement;
		input.value = this.titleTemplate;
		this.registerFocusTracking(input);
		input.addEventListener('input', () => {
			this.titleTemplate = input.value;
		});
		this.titleInputEl = input;
		this.lastFocusedInput = this.titleInputEl;
		this.refreshInsertButton();
	}

	private renderBodyInput(): void {
		const block = this.contentEl.createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.bodyFieldsLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.bodyFieldsDesc') });
		const textarea = block.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: {
				rows: '4',
				placeholder: t('slideView.templateModal.bodyFieldsDesc')
			}
		}) as HTMLTextAreaElement;
		textarea.value = this.bodyTemplate;
		this.registerFocusTracking(textarea);
		textarea.addEventListener('input', () => {
			this.bodyTemplate = textarea.value;
		});
		this.bodyInputEl = textarea;
		this.refreshInsertButton();
	}

	private ensureBodyInputExists(): void {
		if (this.bodyInputEl && this.contentEl.contains(this.bodyInputEl)) {
			return;
		}
		const block = this.contentEl.createDiv({ cls: 'tlb-slide-template__block' });
		block.createEl('div', { cls: 'tlb-slide-template__label', text: t('slideView.templateModal.bodyFieldsLabel') });
		block.createEl('div', { cls: 'tlb-slide-template__hint', text: t('slideView.templateModal.bodyFieldsDesc') });
		const textarea = block.createEl('textarea', {
			cls: 'tlb-slide-template__textarea tlb-slide-template__textarea--body',
			attr: {
				rows: '4',
				placeholder: t('slideView.templateModal.bodyFieldsDesc')
			}
		}) as HTMLTextAreaElement;
		textarea.value = this.bodyTemplate;
		this.registerFocusTracking(textarea);
		textarea.addEventListener('input', () => {
			this.bodyTemplate = textarea.value;
		});
		this.bodyInputEl = textarea;
		this.refreshInsertButton();
	}

	private renderActions(): void {
		const footer = this.contentEl.createDiv({ cls: 'tlb-slide-template__footer' });
		const saveButton = footer.createEl('button', {
			cls: 'mod-cta tlb-slide-template__primary',
			text: t('slideView.templateModal.saveLabel')
		});
		saveButton.addEventListener('click', () => {
			this.onSave({
				titleTemplate: this.titleTemplate,
				bodyTemplate: this.bodyTemplate
			});
			this.close();
		});

		const cancelButton = footer.createEl('button', {
			text: t('slideView.templateModal.cancelLabel')
		});
		cancelButton.addEventListener('click', () => this.close());
	}

	private registerFocusTracking(input: HTMLTextAreaElement): void {
		input.addEventListener('focus', () => {
			this.lastFocusedInput = input;
			this.refreshInsertButton();
		});
		input.addEventListener('blur', () => {
			setTimeout(() => this.refreshInsertButton(), 0);
		});
	}

	private resolveActiveInput(): HTMLTextAreaElement | null {
		const active = document.activeElement;
		if (active instanceof HTMLTextAreaElement && this.contentEl.contains(active)) {
			return active;
		}
		if (this.lastFocusedInput && this.contentEl.contains(this.lastFocusedInput)) {
			return this.lastFocusedInput;
		}
		return null;
	}

	private refreshInsertButton(): void {
		if (!this.insertButtonEl) {
			return;
		}
		this.insertButtonEl.disabled = false;
	}

	private resolveInsertionTarget(): HTMLTextAreaElement | null {
		const active = this.resolveActiveInput();
		if (active) {
			return active;
		}
		if (this.titleInputEl) {
			this.lastFocusedInput = this.titleInputEl;
			this.titleInputEl.focus();
			return this.titleInputEl;
		}
		if (this.bodyInputEl) {
			this.lastFocusedInput = this.bodyInputEl;
			this.bodyInputEl.focus();
			return this.bodyInputEl;
		}
		return null;
	}

	private insertPlaceholder(target: HTMLTextAreaElement, placeholder: string): void {
		const selectionStart = target.selectionStart ?? target.value.length;
		const selectionEnd = target.selectionEnd ?? target.value.length;
		const next =
			target.value.slice(0, selectionStart) +
			placeholder +
			target.value.slice(selectionEnd);
		target.value = next;
		const cursor = selectionStart + placeholder.length;
		target.selectionStart = cursor;
		target.selectionEnd = cursor;
		target.focus();
		target.dispatchEvent(new Event('input'));
	}
}
