import { Modal } from 'obsidian';
import { t } from '../i18n';
import type { InvalidH2Section, StrayContentSection } from './MarkdownBlockParser';

export interface MalformedH2Edit { section: { startLine: number; endLine: number }; text: string; }

interface MalformedH2ModalParams {
	app: Modal['app'];
	sections: Array<InvalidH2Section | StrayContentSection>;
	convertibleCount: number;
	onApply: (edits: MalformedH2Edit[]) => Promise<void> | void;
	onIgnore: () => Promise<void> | void;
	onClose?: () => void;
}

export class MalformedH2Modal extends Modal {
	private readonly params: MalformedH2ModalParams;
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
		contentEl.addClass('tlb-malformed-root');

		const container = contentEl.createDiv({ cls: 'tlb-malformed-container' });
		container.createEl('h3', { text: t('magicMigration.unstructuredTitle'), cls: 'tlb-malformed-heading' });
		container.createEl('div', {
			text: t('magicMigration.unstructuredBody', { sectionCount: this.params.convertibleCount }),
			cls: 'tlb-malformed-summary'
		});
		container.createEl('div', { text: t('magicMigration.unstructuredInstruction'), cls: 'tlb-malformed-reason' });

		const sectionsEl = container.createDiv({ cls: 'tlb-malformed-sections scrollable' });
		const updateRows = (textarea: HTMLTextAreaElement): void => {
			const rows = Math.max(4, textarea.value.split(/\r?\n/).length + 1);
			textarea.rows = rows;
		};
		for (const section of this.params.sections) {
			const block = sectionsEl.createDiv({ cls: 'tlb-malformed-section' });
			const textarea = block.createEl('textarea', { cls: 'tlb-malformed-textarea' });
			textarea.value = section.text;
			updateRows(textarea);
			textarea.addEventListener('input', () => {
				section.text = textarea.value;
				updateRows(textarea);
			});
		}

		container.createEl('div', { text: t('magicMigration.unstructuredHint'), cls: 'tlb-malformed-hint' });

		const actions = container.createDiv({ cls: 'tlb-malformed-actions' });
		const saveButton = actions.createEl('button', { cls: 'mod-cta', text: t('magicMigration.unstructuredEditConvert') });
		saveButton.addEventListener('click', () => {
			if (this.isSaving) return;
			this.isSaving = true;
			const edits: MalformedH2Edit[] = this.params.sections.map((section) => ({
				section: { startLine: section.startLine, endLine: section.endLine },
				text: section.text
			}));
			void Promise.resolve(this.params.onApply(edits)).finally(() => {
				this.isSaving = false;
				this.close();
			});
		});

		const deleteButton = actions.createEl('button', { text: t('magicMigration.unstructuredDeleteConvert') });
		deleteButton.addEventListener('click', () => {
			if (this.isSaving) return;
			this.isSaving = true;
			void Promise.resolve(this.params.onIgnore()).finally(() => {
				this.isSaving = false;
				this.close();
			});
		});

		const cancelButton = actions.createEl('button', { text: t('magicMigration.unstructuredCancel') });
		cancelButton.addEventListener('click', () => {
			if (this.isSaving) return;
			this.close();
		});
	}
}
