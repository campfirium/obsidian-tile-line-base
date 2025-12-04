import { App, Modal, Setting } from 'obsidian';
import { t } from '../../i18n';

interface KanbanFieldModalOptions {
	columns: string[];
	initial: string | null;
	onSubmit(this: void, field: string): void;
	onCancel(this: void): void;
}

export class KanbanFieldModal extends Modal {
	private readonly columns: string[];
	private readonly onSubmit: (field: string) => void;
	private readonly onCancel: () => void;
	private selectedField: string | null;
	private resolved = false;

	constructor(app: App, options: KanbanFieldModalOptions) {
		super(app);
		this.columns = options.columns;
		this.selectedField = options.initial && options.columns.includes(options.initial) ? options.initial : options.columns[0] ?? null;
		this.onSubmit = options.onSubmit;
		this.onCancel = options.onCancel;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('kanbanView.fieldModal.title') });
		contentEl.createEl('p', { text: t('kanbanView.fieldModal.description') });

		new Setting(contentEl)
			.setName(t('kanbanView.fieldModal.laneFieldLabel'))
			.addDropdown((dropdown) => {
				for (const column of this.columns) {
					dropdown.addOption(column, column);
				}
				if (this.selectedField) {
					dropdown.setValue(this.selectedField);
				}
				dropdown.onChange((value) => {
					this.selectedField = value;
				});
			});

		const footer = contentEl.createDiv({ cls: 'tlb-kanban-field-modal__footer' });
		const confirmButton = footer.createEl('button', {
			cls: 'mod-cta',
			text: t('kanbanView.fieldModal.confirmLabel'),
			type: 'button'
		});
		confirmButton.addEventListener('click', () => {
			this.submit();
		});

		const cancelButton = footer.createEl('button', {
			text: t('kanbanView.fieldModal.cancelLabel'),
			type: 'button'
		});
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onCancel();
		}
	}

	private submit(): void {
		if (!this.selectedField) {
			return;
		}
		this.resolved = true;
		this.close();
		this.onSubmit(this.selectedField);
	}
}
