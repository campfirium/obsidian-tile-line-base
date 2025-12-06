import { App, Modal } from 'obsidian';
import { t } from '../../i18n';

interface KanbanCardCreateModalOptions {
	app: App;
	laneName: string;
	laneField: string;
	fields: string[];
	initialValues: Record<string, string>;
	onSubmit: (values: Record<string, string>) => void;
	title?: string;
	submitLabel?: string;
	deleteLabel?: string;
	onDelete?: () => boolean | void;
}

export class KanbanCardCreateModal extends Modal {
	private readonly initialValues: Record<string, string>;
	private readonly values: Record<string, string>;
	private readonly dirtyFields = new Set<string>();
	private readonly fieldOrder: string[];
	private readonly laneField: string;
	private errorEl: HTMLElement | null = null;
	private readonly inputRefs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();

	constructor(private readonly options: KanbanCardCreateModalOptions) {
		super(options.app);
		this.initialValues = { ...options.initialValues };
		this.values = { ...options.initialValues };
		this.laneField = options.laneField;
		this.fieldOrder = this.computeFieldOrder(options.fields);
		this.dirtyFields.add(options.laneField);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-new-card-modal');
		modalEl.addClass('tlb-new-card-modal-container');

		const body = contentEl.createDiv({ cls: 'tlb-modal-content' });

		const header = body.createDiv({ cls: 'tlb-modal-header' });
		header.createSpan({
			text: this.options.title ?? t('kanbanView.cardCreateModal.title'),
			cls: 'tlb-modal-title'
		});

		const fieldsContainer = body.createDiv({ cls: 'tlb-kanban-add-card-modal__fields' });
		this.renderFields(fieldsContainer);

		this.errorEl = contentEl.createDiv({
			cls: 'tlb-kanban-add-card-modal__error',
			attr: { 'aria-live': 'polite' }
		});
		this.errorEl.toggleAttribute('hidden', true);

		const actions = contentEl.createDiv({ cls: 'tlb-modal-footer' });
		if (typeof this.options.onDelete === 'function') {
			actions.addClass('tlb-modal-footer--with-danger');
			const deleteButton = actions.createEl('button', {
				text: this.options.deleteLabel ?? t('kanbanView.cardEditModal.deleteLabel'),
				attr: { type: 'button' }
			});
			deleteButton.addClass('mod-warning');
			deleteButton.addClass('tlb-modal-footer__danger');
			deleteButton.addEventListener('click', () => {
				const shouldClose = this.options.onDelete?.();
				if (shouldClose !== false) {
					this.close();
				}
			});
		}
		const cancelButton = actions.createEl('button', {
			text: t('kanbanView.cardCreateModal.cancelLabel'),
			attr: { type: 'button' }
		});
		cancelButton.addEventListener('click', () => {
			this.close();
		});

		const submitButton = actions.createEl('button', {
			text: this.options.submitLabel ?? t('kanbanView.cardCreateModal.submitLabel'),
			attr: { type: 'button' }
		});
		submitButton.classList.add('mod-cta');
		submitButton.addEventListener('click', () => {
			this.submit();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private computeFieldOrder(fields: string[]): string[] {
		const order: string[] = [];
		const seen = new Set<string>();
		const push = (field: string | null | undefined) => {
			if (!field) return;
			const trimmed = field.trim();
			if (!trimmed || trimmed === this.laneField || seen.has(trimmed)) {
				return;
			}
			seen.add(trimmed);
			order.push(trimmed);
		};

		for (const field of fields) {
			push(field);
		}
		return order;
	}

	private renderFields(container: HTMLElement): void {
		for (const field of this.fieldOrder) {
			const fieldContainer = container.createDiv({
				cls: 'tlb-kanban-add-card-modal__field'
			});
			const initial = this.initialValues[field] ?? '';
			const input = fieldContainer.createEl('input', {
				type: 'text',
				cls: ['text-input', 'tlb-kanban-add-card-modal__input', 'tlb-field-input'],
				attr: { 'aria-label': field, value: initial, placeholder: field }
			});
			this.inputRefs.set(field, input);
			input.addEventListener('input', (event) => {
				const value = (event.target as HTMLInputElement).value;
				this.values[field] = value;
				if (value === initial) {
					this.dirtyFields.delete(field);
				} else {
					this.dirtyFields.add(field);
				}
			});

			const inputEl = this.inputRefs.get(field);
			if (inputEl && !inputEl.id) {
				inputEl.id = `tlb-kanban-field-${field}-${Math.random().toString(36).slice(2, 7)}`;
			}
		}
	}

	private submit(): void {
		const laneValue = (this.initialValues[this.laneField] ?? this.values[this.laneField] ?? '').trim();
		if (!laneValue) {
			this.showError(t('kanbanView.cardCreateModal.laneRequiredError'));
			return;
		}
		this.showError('');

		const payload: Record<string, string> = {
			[this.laneField]: laneValue
		};

		for (const field of this.fieldOrder) {
			if (field === this.laneField) {
				continue;
			}
			if (!this.dirtyFields.has(field)) {
				continue;
			}
			payload[field] = (this.values[field] ?? '').trim();
		}

		this.close();
		this.options.onSubmit(payload);
	}

	private showError(message: string): void {
		if (!this.errorEl) {
			return;
		}
		this.errorEl.textContent = message;
		this.errorEl.toggleAttribute('hidden', message.trim().length === 0);
	}
}
