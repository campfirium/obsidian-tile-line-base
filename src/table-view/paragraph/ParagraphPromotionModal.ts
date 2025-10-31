import { App, Modal } from 'obsidian';
import { t } from '../../i18n';

interface ParagraphPromotionModalOptions {
	app: App;
	columns: string[];
	initialSelection: Set<string>;
	includeEmptyFields: boolean;
	onSubmit: (result: { selected: string[]; includeEmpty: boolean }) => void;
	onCancel: () => void;
}

interface TogglePair {
	yaml: HTMLInputElement;
	body: HTMLInputElement;
}

export class ParagraphPromotionModal extends Modal {
	private readonly options: ParagraphPromotionModalOptions;
	private readonly selectedYaml: Set<string>;
	private toggleRefs: Map<string, TogglePair> = new Map();
	private includeEmptyFields: boolean;
	private suppressToggle = false;
	private globalToggle: TogglePair | null = null;

	constructor(options: ParagraphPromotionModalOptions) {
		super(options.app);
		this.options = options;
		this.selectedYaml = new Set(options.initialSelection);
		this.includeEmptyFields = options.includeEmptyFields ?? true;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('tlb-paragraph-promotion-modal');
		this.titleEl.setText(t('paragraphPromotion.modalTitle'));

		const description = contentEl.createEl('p', { cls: 'setting-item-description' });
		description.setText(t('paragraphPromotion.modalDescription'));

		if (this.options.columns.length === 0) {
			const emptyState = contentEl.createDiv({ cls: 'setting-item-description' });
			emptyState.setText(t('paragraphPromotion.noColumns'));
			this.renderButtons(contentEl);
			return;
		}

		this.renderColumnList(contentEl);
		this.renderButtons(contentEl);
	}

	onClose(): void {
		this.options.onCancel();
		this.toggleRefs.clear();
		this.contentEl.empty();
	}

	private renderColumnList(container: HTMLElement): void {
		const listWrapper = container.createDiv({ cls: 'tlb-paragraph-promotion-columns' });
		this.toggleRefs = new Map();

		this.renderIncludeEmptyRow(listWrapper);
		this.renderHeaderRow(listWrapper);
		this.renderGlobalRow(listWrapper);

		for (const column of this.options.columns) {
			this.renderFieldRow(listWrapper, column);
		}

	}

	private renderButtons(container: HTMLElement): void {
		const buttonBar = container.createDiv({ cls: 'modal-button-container' });
		const confirmButton = buttonBar.createEl('button', { text: t('paragraphPromotion.confirmButton') });
		confirmButton.addClass('mod-cta');
		confirmButton.addEventListener('click', () => {
			this.submit();
		});

		const cancelButton = buttonBar.createEl('button', { text: t('paragraphPromotion.cancelButton') });
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	private submit(): void {
		const result = Array.from(this.selectedYaml);
		this.options.onSubmit({ selected: result, includeEmpty: this.includeEmptyFields });
		this.close();
	}

	private renderHeaderRow(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: 'tlb-paragraph-promotion-header' });
		header.createSpan({
			text: t('paragraphPromotion.fieldsColumnLabel'),
			cls: 'tlb-paragraph-promotion-header__label'
		});
		header.createSpan({
			text: t('paragraphPromotion.yamlColumnLabel'),
			cls: 'tlb-paragraph-promotion-header__label tlb-paragraph-promotion-header__label--center'
		});
		header.createSpan({
			text: t('paragraphPromotion.bodyColumnLabel'),
			cls: 'tlb-paragraph-promotion-header__label tlb-paragraph-promotion-header__label--center'
		});
	}

	private renderGlobalRow(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'tlb-paragraph-promotion-row tlb-paragraph-promotion-row-global' });
		const labelCell = row.createDiv({ cls: 'tlb-paragraph-promotion-cell tlb-paragraph-promotion-cell-label' });
		labelCell.createSpan({ text: t('paragraphPromotion.globalRowLabel'), cls: 'tlb-paragraph-promotion-row__title' });

		const yamlCell = row.createDiv({ cls: 'tlb-paragraph-promotion-cell tlb-paragraph-promotion-cell-toggle' });
		const yamlRadio = yamlCell.createEl('input', { type: 'radio' });
		yamlRadio.name = 'tlb-paragraph-choice-global';
		yamlRadio.addEventListener('change', () => {
			if (this.suppressToggle || !yamlRadio.checked) {
				return;
			}
			this.bulkToggle(true);
		});

		const bodyCell = row.createDiv({ cls: 'tlb-paragraph-promotion-cell tlb-paragraph-promotion-cell-toggle' });
		const bodyRadio = bodyCell.createEl('input', { type: 'radio' });
		bodyRadio.name = 'tlb-paragraph-choice-global';
		bodyRadio.addEventListener('change', () => {
			if (this.suppressToggle || !bodyRadio.checked) {
				return;
			}
			this.bulkToggle(false);
		});

		this.globalToggle = { yaml: yamlRadio, body: bodyRadio };
		this.updateGlobalRowState();
	}

	private renderIncludeEmptyRow(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'tlb-paragraph-promotion-include-row' });
		const label = row.createDiv({ cls: 'tlb-paragraph-promotion-include-row__label' });
		label.createSpan({ text: t('paragraphPromotion.includeEmptyLabel'), cls: 'tlb-paragraph-promotion-row__title' });
		label.createSpan({
			text: t('paragraphPromotion.includeEmptyDescription'),
			cls: 'tlb-paragraph-promotion-row__description'
		});
		const includeCheckbox = row.createEl('input', { type: 'checkbox', cls: 'tlb-paragraph-promotion-include-row__toggle' });
		includeCheckbox.checked = this.includeEmptyFields;
		includeCheckbox.addEventListener('change', () => {
			this.includeEmptyFields = includeCheckbox.checked;
		});
	}

	private renderFieldRow(parent: HTMLElement, field: string): void {
		const row = parent.createDiv({ cls: 'tlb-paragraph-promotion-row' });
		const labelCell = row.createDiv({ cls: 'tlb-paragraph-promotion-cell tlb-paragraph-promotion-cell-label' });
		labelCell.createSpan({ text: field, cls: 'tlb-paragraph-promotion-row__title' });

		const yamlCell = row.createDiv({ cls: 'tlb-paragraph-promotion-cell tlb-paragraph-promotion-cell-toggle' });
		const yamlRadio = yamlCell.createEl('input', { type: 'radio' });
		yamlRadio.name = `tlb-paragraph-choice-${field}`;
		yamlRadio.checked = this.selectedYaml.has(field);
		yamlRadio.addEventListener('change', () => {
			if (this.suppressToggle || !yamlRadio.checked) {
				return;
			}
			this.applyYamlSelection(field, true);
		});

		const bodyCell = row.createDiv({ cls: 'tlb-paragraph-promotion-cell tlb-paragraph-promotion-cell-toggle' });
		const bodyRadio = bodyCell.createEl('input', { type: 'radio' });
		bodyRadio.name = `tlb-paragraph-choice-${field}`;
		bodyRadio.checked = !this.selectedYaml.has(field);
		bodyRadio.addEventListener('change', () => {
			if (this.suppressToggle || !bodyRadio.checked) {
				return;
			}
			this.applyYamlSelection(field, false);
		});

		this.toggleRefs.set(field, { yaml: yamlRadio, body: bodyRadio });
		this.updateGlobalRowState();
	}

	private bulkToggle(selectYaml: boolean): void {
		const previous = this.suppressToggle;
		this.suppressToggle = true;
		for (const field of this.toggleRefs.keys()) {
			this.applyYamlSelection(field, selectYaml, true);
		}
		this.suppressToggle = previous;
		this.updateGlobalRowState();
	}

	private updateGlobalRowState(): void {
		if (!this.globalToggle) {
			return;
		}
		const total = this.toggleRefs.size;
		const yamlRadio = this.globalToggle.yaml;
		const bodyRadio = this.globalToggle.body;
		const yamlCount = this.selectedYaml.size;
		const previous = this.suppressToggle;
		this.suppressToggle = true;
		yamlRadio.checked = yamlCount === total && total > 0;
		bodyRadio.checked = yamlCount === 0 && total > 0;
		if (yamlCount !== 0 && yamlCount !== total) {
			yamlRadio.checked = false;
			bodyRadio.checked = false;
		}
		this.suppressToggle = previous;
	}

	private applyYamlSelection(field: string, yamlSelected: boolean, suppressGlobalUpdate = false): void {
		if (yamlSelected) {
			this.selectedYaml.add(field);
		} else {
			this.selectedYaml.delete(field);
		}
		const toggles = this.toggleRefs.get(field);
		if (!toggles) {
			return;
		}
		const previous = this.suppressToggle;
		this.suppressToggle = true;
		toggles.yaml.checked = yamlSelected;
		toggles.body.checked = !yamlSelected;
		this.suppressToggle = previous;
		if (!suppressGlobalUpdate) {
			this.updateGlobalRowState();
		}
	}
}

export function openParagraphPromotionModal(
	app: App,
	options: { columns: string[]; initialSelection?: string[]; includeEmptyFields?: boolean }
): Promise<{ selected: string[]; includeEmpty: boolean } | null> {
	return new Promise((resolve) => {
		const modal = new ParagraphPromotionModal({
			app,
			columns: options.columns,
			initialSelection: new Set(options.initialSelection ?? options.columns),
			includeEmptyFields: options.includeEmptyFields ?? true,
			onSubmit: (result) => resolve(result),
			onCancel: () => resolve(null)
		});
		modal.open();
	});
}
