import { Modal } from 'obsidian';
import { t } from '../i18n';
import type { InvalidH2Section } from './MarkdownBlockParser';

export interface MalformedH2Edit {
	section: InvalidH2Section;
	text: string;
}

interface MalformedH2ModalParams {
	app: Modal['app'];
	sections: InvalidH2Section[];
	totalSections: number;
	onApply: (edits: MalformedH2Edit[]) => Promise<void> | void;
	onIgnore: () => void;
	onClose?: () => void;
}

export class MalformedH2Modal extends Modal {
	private readonly params: MalformedH2ModalParams;
	private readonly edits: MalformedH2Edit[] = [];
	private isSaving = false;

	constructor(params: MalformedH2ModalParams) {
		super(params.app);
		this.params = params;
	}

	onClose(): void {
		this.params.onClose?.();
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('magicMigration.modalTitle'));

		modalEl.addClass('tlb-conversion-modal');
		modalEl.addClass('tlb-malformed-modal');
		contentEl.addClass('tlb-malformed-simple');

		const container = contentEl.createDiv({ cls: 'tlb-malformed-container' });
		container.createEl('h3', { text: t('magicMigration.malformedTitle'), cls: 'tlb-malformed-heading' });
		container.createEl('div', {
			text: t('magicMigration.malformedSummary', {
				total: this.params.totalSections,
				invalid: this.params.sections.length
			}),
			cls: 'tlb-malformed-summary'
		});

		for (const section of this.params.sections) {
			const block = container.createDiv({ cls: 'tlb-malformed-section' });
			block.createEl('div', {
				text:
					section.reason === 'missingColon'
						? t('magicMigration.malformedReasonMissingColon')
						: t('magicMigration.malformedReasonInvalidField'),
				cls: 'tlb-malformed-section-hint'
			});
			const textarea = block.createEl('textarea', { cls: 'tlb-malformed-textarea' });
			textarea.value = section.text;
			textarea.setAttr('rows', Math.max(16, Math.min(26, section.endLine - section.startLine + 8)));
			const edit: MalformedH2Edit = { section, text: section.text };
			this.edits.push(edit);
			textarea.addEventListener('input', () => {
				edit.text = textarea.value;
			});
		}

		container.createEl('div', { text: t('magicMigration.malformedEditWarning'), cls: 'tlb-malformed-hint' });

		const actions = container.createDiv({ cls: 'tlb-malformed-actions' });
		const saveButton = actions.createEl('button', { cls: 'mod-cta', text: t('magicMigration.malformedApply') });
		saveButton.addEventListener('click', () => {
			if (this.isSaving) return;
			this.isSaving = true;
			void Promise.resolve(this.params.onApply(this.edits)).finally(() => {
				this.isSaving = false;
				this.close();
			});
		});
		const ignoreButton = actions.createEl('button', { text: t('magicMigration.malformedIgnore') });
		ignoreButton.addEventListener('click', () => {
			this.params.onIgnore();
			this.close();
		});
	}
}
