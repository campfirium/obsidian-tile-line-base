import { App, Modal, Setting } from 'obsidian';
import { t } from '../../i18n';

interface LanePresetModalOptions {
	app: App;
	laneField: string;
	existingPresets: string[];
}

export function openKanbanLanePresetModal(options: LanePresetModalOptions): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new KanbanLanePresetModal(options, resolve);
		modal.open();
	});
}

class KanbanLanePresetModal extends Modal {
	private value = '';
	private readonly existingKeys: Set<string>;
	private resolved = false;
	private errorEl: HTMLParagraphElement | null = null;
	private inputEl: HTMLInputElement | null = null;

	constructor(
		private readonly options: LanePresetModalOptions,
		private readonly onResult: (value: string | null) => void
	) {
		super(options.app);
		this.existingKeys = new Set(
			options.existingPresets
				.filter((entry) => typeof entry === 'string')
				.map((entry) => entry.trim().toLowerCase())
				.filter((entry) => entry.length > 0)
		);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('kanbanView.lanePresetModal.title') });
		contentEl.createEl('p', {
			text: t('kanbanView.lanePresetModal.description', { field: this.options.laneField })
		});

		const fieldSetting = new Setting(contentEl);
		fieldSetting.setName(t('kanbanView.lanePresetModal.fieldLabel'));
		fieldSetting.setDesc(t('kanbanView.lanePresetModal.fieldDescription'));
		fieldSetting.addText((text) => {
			this.inputEl = text.inputEl;
			text.setPlaceholder(t('kanbanView.lanePresetModal.placeholder'));
			text.onChange((value) => {
				this.value = value;
				if (value.trim().length > 0) {
					this.inputEl?.removeAttribute('aria-invalid');
					this.showError(null);
				}
			});
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					this.submit();
				}
			});
			setTimeout(() => text.inputEl.focus(), 0);
		});

		this.errorEl = contentEl.createEl('p', { cls: 'tlb-form-message is-error' });
		this.errorEl.hide();

		const actions = contentEl.createDiv({ cls: 'tlb-kanban-lane-preset-modal__actions' });
		const confirmButton = actions.createEl('button', {
			cls: 'mod-cta',
			text: t('kanbanView.lanePresetModal.confirmLabel'),
			type: 'button'
		});
		confirmButton.addEventListener('click', () => this.submit());

		const cancelButton = actions.createEl('button', {
			text: t('kanbanView.lanePresetModal.cancelLabel'),
			type: 'button'
		});
		cancelButton.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onResult(null);
		}
	}

	private submit(): void {
		const trimmed = this.value.trim();
		if (!trimmed) {
			this.showError(t('kanbanView.lanePresetModal.emptyError'));
			return;
		}
		const normalized = trimmed.toLowerCase();
		if (this.existingKeys.has(normalized)) {
			this.showError(t('kanbanView.lanePresetModal.duplicateError'));
			return;
		}
		this.resolved = true;
		this.close();
		this.onResult(trimmed);
	}

	private showError(message: string | null): void {
		if (message) {
			this.inputEl?.setAttribute('aria-invalid', 'true');
		} else {
			this.inputEl?.removeAttribute('aria-invalid');
		}
		if (!this.errorEl) {
			return;
		}
		if (message) {
			this.errorEl.setText(message);
			this.errorEl.show();
		} else {
			this.errorEl.empty();
			this.errorEl.hide();
		}
	}
}
