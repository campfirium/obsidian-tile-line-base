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
		contentEl.addClass('tlb-magic-inline');
		const shell = contentEl.createDiv({ cls: 'tlb-magic-inline tlb-magic-inline--panel tlb-magic-inline--single tlb-malformed-shell' });

		const header = shell.createDiv({ cls: 'tlb-magic-inline__header tlb-magic-inline__header--compact' });
		header.createEl('h3', { text: t('magicMigration.malformedTitle') });
		const summary = shell.createDiv({ cls: 'tlb-magic-inline__callout' });
		summary.createDiv({
			cls: 'tlb-magic-inline__summary tlb-magic-inline__summary--primary',
			text: t('magicMigration.malformedSummary', {
				total: this.params.totalSections,
				invalid: this.params.sections.length,
				valid: Math.max(0, this.params.totalSections - this.params.sections.length)
			})
		});

		const body = shell.createDiv({ cls: 'tlb-magic-inline__body tlb-magic-inline__body--stack' });
		const list = body.createDiv({ cls: 'tlb-magic-inline__malformed-list' });
		for (const section of this.params.sections) {
			const card = list.createDiv({ cls: 'tlb-magic-inline__section tlb-magic-inline__card' });
			const titleRow = card.createDiv({ cls: 'tlb-magic-inline__card-title' });
			titleRow.createEl('div', {
				text: t('magicMigration.malformedSectionLabel', { line: section.startLine + 1 }),
				cls: 'tlb-magic-inline__section-title'
			});
			titleRow.createEl('div', {
				text:
					section.reason === 'missingColon'
						? t('magicMigration.malformedReasonMissingColon')
						: t('magicMigration.malformedReasonInvalidField'),
				cls: 'tlb-magic-inline__section-reason'
			});
			const editor = card.createDiv({ cls: 'tlb-magic-inline__editor' });
			const textarea = editor.createEl('textarea', { cls: 'tlb-magic-inline__textarea tlb-magic-inline__textarea--code' });
			textarea.value = section.text;
			textarea.setAttr('rows', Math.max(14, Math.min(24, section.endLine - section.startLine + 6)));
			const edit: MalformedH2Edit = { section, text: section.text };
			this.edits.push(edit);
			textarea.addEventListener('input', () => {
				edit.text = textarea.value;
			});
		}

		const footer = shell.createDiv({ cls: 'tlb-magic-inline__footer' });
		footer.createDiv({ cls: 'tlb-magic-inline__hint', text: t('magicMigration.malformedEditWarning') });
		const actions = footer.createDiv({ cls: 'tlb-magic-inline__actions tlb-magic-inline__actions--trailing' });
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
