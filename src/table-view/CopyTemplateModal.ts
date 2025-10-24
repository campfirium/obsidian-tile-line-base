import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import { FormulaFieldSuggester } from './FormulaFieldSuggester';

interface CopyTemplateModalOptions {
	initialTemplate: string;
	availableFields: string[];
	onSubmit: (template: string) => void;
	onReset: () => string;
	onCancel: () => void;
	triggerElement: HTMLElement | null;
}

export class CopyTemplateModal extends Modal {
	private readonly options: CopyTemplateModalOptions;
	private templateValue: string;
	private textarea!: HTMLTextAreaElement;
	private submitted = false;
	private returnFocusTarget: HTMLElement | null = null;
	private keydownHandler?: (event: KeyboardEvent) => void;
	private suggester?: FormulaFieldSuggester;

	constructor(app: App, options: CopyTemplateModalOptions) {
		super(app);
		this.options = options;
		this.templateValue = options.initialTemplate;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		const ownerDoc = contentEl.ownerDocument ?? document;

		const trigger = this.options.triggerElement;
		if (trigger && trigger instanceof HTMLElement) {
			this.returnFocusTarget = trigger;
		} else if (ownerDoc.activeElement instanceof HTMLElement) {
			this.returnFocusTarget = ownerDoc.activeElement;
		}

		contentEl.empty();
		contentEl.addClass('tlb-copy-template-modal');
		this.titleEl.setText(t('copyTemplate.modalTitle'));

		contentEl.createEl('p', { text: t('copyTemplate.modalDescription') });

		const inputWrapper = contentEl.createDiv({ cls: 'tlb-copy-template-input-wrapper' });
		inputWrapper.style.width = '100%';
		this.textarea = ownerDoc.createElement('textarea');
		this.textarea.className = 'tlb-copy-template-input';
		this.textarea.rows = 10;
		this.textarea.style.width = '100%';
		this.textarea.style.boxSizing = 'border-box';
		this.textarea.style.fontFamily = 'var(--font-monospace)';
		this.textarea.style.lineHeight = '1.5';
		this.textarea.style.minHeight = '220px';
		this.textarea.placeholder = t('copyTemplate.templatePlaceholder');
		this.textarea.value = this.templateValue;
		this.textarea.addEventListener('input', () => {
			this.templateValue = this.textarea.value;
		});
		inputWrapper.appendChild(this.textarea);

		if (this.options.availableFields.length > 0) {
			this.suggester = new FormulaFieldSuggester({
				input: this.textarea,
				fields: this.options.availableFields,
				ownerDocument: ownerDoc
			});
		}

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

		const actionSetting = new Setting(contentEl);
		actionSetting.addButton((button) => {
			button.setButtonText(t('copyTemplate.saveButton'))
				.setCta()
				.onClick(() => {
					this.submitted = true;
					this.options.onSubmit(this.templateValue);
					this.close();
				});
		});
		actionSetting.addButton((button) => {
			button.setButtonText(t('copyTemplate.resetButton')).onClick(() => {
				const resetValue = this.options.onReset();
				this.templateValue = resetValue;
				this.textarea.value = resetValue;
				this.textarea.focus({ preventScroll: true });
				this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
			});
		});
		actionSetting.addButton((button) => {
			button.setButtonText(t('copyTemplate.cancelButton')).onClick(() => {
				this.close();
			});
		});

		const focusTextarea = () => {
			this.textarea.focus({ preventScroll: true });
			this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
		};
		const raf = ownerDoc.defaultView?.requestAnimationFrame ?? window.requestAnimationFrame;
		if (typeof raf === 'function') {
			raf(() => focusTextarea());
		} else {
			window.setTimeout(() => focusTextarea(), 0);
		}
	}

	onClose(): void {
		if (this.modalEl && this.keydownHandler) {
			this.modalEl.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = undefined;
		}
		if (this.suggester) {
			this.suggester.destroy();
			this.suggester = undefined;
		}

		if (!this.submitted) {
			this.options.onCancel();
		}

		if (this.returnFocusTarget && this.returnFocusTarget.isConnected) {
			this.returnFocusTarget.focus({ preventScroll: true });
		} else if (this.options.triggerElement && this.options.triggerElement.isConnected) {
			this.options.triggerElement.focus({ preventScroll: true });
		}

		this.returnFocusTarget = null;
	}
}
