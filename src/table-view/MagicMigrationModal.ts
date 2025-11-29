import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

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
	computePreview: (template: string, sample: string) => MagicMigrationPreview;
	onSubmit: (template: string, sample: string) => Promise<boolean>;
	onClose: (latestTemplate: string, latestSample: string) => void;
}

export class MagicMigrationModal extends Modal {
	private readonly options: MagicMigrationModalOptions;
	private templateValue: string;
	private sampleValue: string;
	private preview: MagicMigrationPreview;
	private previewContainer: HTMLElement | null = null;
	private previewStatusEl: HTMLElement | null = null;
	private convertButton: HTMLButtonElement | null = null;
	private isSubmitting = false;
	private returnFocusTarget: HTMLElement | null = null;
	private keydownHandler?: (event: KeyboardEvent) => void;

	constructor(app: App, options: MagicMigrationModalOptions) {
		super(app);
		this.options = options;
		this.templateValue = options.initialTemplate;
		this.sampleValue = options.initialSample;
		this.preview = options.computePreview(this.templateValue, this.sampleValue);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		const ownerDoc = contentEl.ownerDocument ?? document;
		const activeElement = ownerDoc.activeElement;
		if (activeElement instanceof HTMLElement) {
			this.returnFocusTarget = activeElement;
		}

		contentEl.empty();
		contentEl.addClass('tlb-magic-migration-modal');
		this.titleEl.setText(t('magicMigration.modalTitle'));

		contentEl.createEl('p', { text: t('magicMigration.modalDescription') });

		const targetSetting = new Setting(contentEl);
		targetSetting.setName(t('magicMigration.targetFileLabel'));
		targetSetting.setDesc(t('magicMigration.targetFileHint'));
		targetSetting.addText((text) => {
			text.setValue(this.options.targetFileName).setDisabled(true);
		});

		const sampleSetting = new Setting(contentEl);
		sampleSetting.setName(t('magicMigration.sampleLabel'));
		sampleSetting.setDesc(t('magicMigration.sampleHint'));
		sampleSetting.controlEl.empty();
		const sampleInput = ownerDoc.createElement('textarea');
		sampleInput.className = 'tlb-magic-sample-input';
		sampleInput.rows = 4;
		sampleInput.placeholder = t('magicMigration.samplePlaceholder');
		sampleInput.value = this.sampleValue;
		sampleInput.addEventListener('input', () => {
			this.sampleValue = sampleInput.value;
			this.preview = this.options.computePreview(this.templateValue, this.sampleValue);
			this.renderPreview();
			this.syncConvertButton();
		});
		sampleSetting.controlEl.appendChild(sampleInput);

		const templateSetting = new Setting(contentEl);
		templateSetting.setName(t('magicMigration.templateLabel'));
		templateSetting.setDesc(t('magicMigration.templateHint'));
		templateSetting.controlEl.empty();
		const textarea = ownerDoc.createElement('textarea');
		textarea.className = 'tlb-magic-template-input';
		textarea.rows = 6;
		textarea.value = this.templateValue;
		textarea.placeholder = t('magicMigration.templatePlaceholder');
		textarea.addEventListener('input', () => {
			this.templateValue = textarea.value;
			this.preview = this.options.computePreview(this.templateValue, this.sampleValue);
			this.renderPreview();
			this.syncConvertButton();
		});
		templateSetting.controlEl.appendChild(textarea);

		const previewSection = contentEl.createDiv({ cls: 'tlb-magic-preview' });
		previewSection.createEl('div', {
			text: t('magicMigration.previewTitle'),
			cls: 'tlb-magic-preview__title'
		});
		this.previewStatusEl = previewSection.createDiv({ cls: 'tlb-magic-preview__status' });
		this.previewContainer = previewSection.createDiv({ cls: 'tlb-magic-preview__table' });
		this.renderPreview();

		const actionSetting = new Setting(contentEl);
		actionSetting.addButton((button) => {
			button.setButtonText(t('magicMigration.convertButton')).setCta();
			this.convertButton = button.buttonEl;
			this.syncConvertButton();
			button.onClick(() => {
				void this.handleSubmit();
			});
		});
		actionSetting.addButton((button) => {
			button.setButtonText(t('magicMigration.cancelButton')).onClick(() => this.close());
		});

		const raf = ownerDoc.defaultView?.requestAnimationFrame ?? window.requestAnimationFrame;
		const focusTemplate = () => {
			textarea.focus({ preventScroll: true });
			textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		};
		if (typeof raf === 'function') {
			raf(() => focusTemplate());
		} else {
			window.setTimeout(() => focusTemplate(), 0);
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
	}

	onClose(): void {
		if (this.modalEl && this.keydownHandler) {
			this.modalEl.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = undefined;
		}
		this.options.onClose(this.templateValue, this.sampleValue);
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
			const success = await this.options.onSubmit(this.templateValue, this.sampleValue);
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

	private renderPreview(): void {
		if (!this.previewContainer || !this.previewStatusEl) {
			return;
		}
		this.previewContainer.empty();
		const preview = this.preview;

		if (preview.error) {
			this.previewStatusEl.setText(preview.error);
			return;
		}

		if (preview.rows.length === 0) {
			this.previewStatusEl.setText(t('magicMigration.previewEmpty'));
			return;
		}

		const countText = preview.truncated
			? t('magicMigration.previewTruncated', {
					shown: String(preview.rows.length),
					total: String(preview.matchCount)
				})
			: t('magicMigration.previewCount', { count: String(preview.matchCount) });
		const noiseHint = t('magicMigration.previewNoiseHint');
		this.previewStatusEl.setText(`${countText} · ${noiseHint}`);

		const table = this.previewContainer.createEl('table', { cls: 'tlb-magic-preview-table' });
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');
		for (const column of preview.columns) {
			headerRow.createEl('th', { text: column });
		}

		const tbody = table.createEl('tbody');
		for (const row of preview.rows) {
			const tr = tbody.createEl('tr');
			for (const cell of row) {
				tr.createEl('td', { text: cell });
			}
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
}
