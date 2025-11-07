import { Menu, ToggleComponent } from 'obsidian';
import { getLocaleCode, t } from '../../i18n';
import type { KanbanCardContentConfig } from '../../types/kanban';
import { wrapPlaceholder } from './KanbanCardContent';
import { cloneKanbanContentConfig } from './KanbanContentConfig';

export interface ContentEditorOptions {
	container: HTMLElement;
	getFields: () => string[];
	initialContent: KanbanCardContentConfig;
	onChange: (next: KanbanCardContentConfig) => void;
	onDirty: () => void;
}

export interface ContentEditorHandle {
	update(value: KanbanCardContentConfig): void;
	refresh(): void;
}

export function renderContentSettingsEditor(options: ContentEditorOptions): ContentEditorHandle {
	const root = options.container.createDiv({ cls: 'tlb-kanban-content-settings' });
	const header = root.createDiv({ cls: 'tlb-kanban-content-settings__header' });
	header.createSpan({
		cls: 'tlb-kanban-content-settings__title',
		text: t('kanbanView.content.sectionTitle')
	});
	const insertButton = header.createEl('button', {
		cls: 'tlb-kanban-content-settings__insert-button',
		text: t('kanbanView.content.insertFieldButton'),
		attr: { type: 'button' }
	});
	insertButton.disabled = true;
	insertButton.addEventListener('mousedown', (event) => {
		event.preventDefault();
	});

	const state = cloneKanbanContentConfig(options.initialContent);
	const notifyChange = () => options.onChange(cloneKanbanContentConfig(state));
	let suppressDirty = false;
	let lastFocusedInput: HTMLInputElement | HTMLTextAreaElement | null = null;

	const resolveActiveInput = (): HTMLInputElement | HTMLTextAreaElement | null => {
		const active = document.activeElement as HTMLElement | null;
		if (active && root.contains(active)) {
			if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
				return active;
			}
		}
		return lastFocusedInput && root.contains(lastFocusedInput) ? lastFocusedInput : null;
	};

	const refreshInsertButton = () => {
		const hasFields = options.getFields().length > 0;
		insertButton.disabled = !hasFields || !resolveActiveInput();
	};

	const createTemplateInput = (config: {
		label: string;
		placeholder: string;
		value: string;
		multiline?: boolean;
		rows?: number;
		assign: (value: string) => void;
		renderHeaderExtras?: (container: HTMLElement) => void;
	}): HTMLTextAreaElement | HTMLInputElement => {
		const group = root.createDiv({ cls: 'tlb-kanban-content-settings__group' });
		const groupHeader = group.createDiv({ cls: 'tlb-kanban-content-settings__group-header' });
		groupHeader.createSpan({ cls: 'tlb-kanban-content-settings__label', text: config.label });
		if (config.renderHeaderExtras) {
			const extras = groupHeader.createDiv({ cls: 'tlb-kanban-content-settings__header-extras' });
			config.renderHeaderExtras(extras);
		}
		const inputWrapper = group.createDiv({ cls: 'tlb-kanban-content-settings__input-wrapper' });
		const inputEl = config.multiline
			? (inputWrapper.createEl('textarea', {
					cls: 'tlb-kanban-content-settings__input tlb-kanban-content-settings__input--multiline',
					placeholder: config.placeholder
				}) as HTMLTextAreaElement)
			: (inputWrapper.createEl('input', {
					cls: 'tlb-kanban-content-settings__input',
					type: 'text',
					placeholder: config.placeholder
				}) as HTMLInputElement);
		if (config.multiline && config.rows) {
			(inputEl as HTMLTextAreaElement).rows = config.rows;
			(inputEl as HTMLTextAreaElement).wrap = 'off';
		}
		inputEl.value = config.value;
		inputEl.spellcheck = false;
		inputEl.addEventListener('focus', () => {
			lastFocusedInput = inputEl;
			refreshInsertButton();
		});
		inputEl.addEventListener('blur', () => {
			setTimeout(() => {
				refreshInsertButton();
			}, 0);
		});
		inputEl.addEventListener('input', () => {
			if (!suppressDirty) {
				options.onDirty();
			}
			const normalized = normalizeTemplateInput(inputEl.value);
			if (normalized !== inputEl.value) {
				inputEl.value = normalized;
			}
			config.assign(normalized);
			notifyChange();
		});
		return inputEl;
	};

	let titleInput: HTMLInputElement;
	let bodyInput: HTMLTextAreaElement;
	let tagsInput: HTMLInputElement;
	let bodyToggle: ToggleComponent | null = null;
	let tagsToggle: ToggleComponent | null = null;

	const getInsertionTarget = (): HTMLInputElement | HTMLTextAreaElement => {
		const target = resolveActiveInput();
		if (target) {
			return target;
		}
		titleInput.focus();
		lastFocusedInput = titleInput;
		refreshInsertButton();
		return titleInput;
	};

	insertButton.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const fields = options.getFields();
		if (fields.length === 0) {
			return;
		}
		const target = getInsertionTarget();
		openFieldMenu(event, fields, (field) => {
			insertPlaceholder(target, field);
		});
	});

	titleInput = createTemplateInput({
		label: t('kanbanView.content.titleLabel'),
		placeholder: t('kanbanView.content.titlePlaceholder'),
		value: state.titleTemplate,
		assign: (value) => {
			state.titleTemplate = value;
		}
	}) as HTMLInputElement;

	bodyInput = createTemplateInput({
		label: t('kanbanView.content.bodyLabel'),
		placeholder: t('kanbanView.content.bodyPlaceholder'),
		value: state.bodyTemplate,
		multiline: true,
		rows: 2,
		renderHeaderExtras: (container) => {
			container.createSpan({ cls: 'tlb-kanban-content-settings__toggle-label', text: t('kanbanView.content.showBodyToggle') });
			bodyToggle = new ToggleComponent(container);
			bodyToggle.setValue(state.showBody);
			bodyToggle.setTooltip(t('kanbanView.content.showBodyToggleDesc'));
			bodyToggle.onChange((value) => {
				if (!suppressDirty) {
					options.onDirty();
				}
				state.showBody = value;
				notifyChange();
			});
		},
		assign: (value) => {
			state.bodyTemplate = value;
		}
	}) as HTMLTextAreaElement;

	tagsInput = createTemplateInput({
		label: t('kanbanView.content.tagsLabel'),
		placeholder: t('kanbanView.content.tagsPlaceholder'),
		value: state.tagsTemplate,
		multiline: false,
		renderHeaderExtras: (container) => {
			container.createSpan({ cls: 'tlb-kanban-content-settings__toggle-label', text: t('kanbanView.content.tagsBelowBodyToggle') });
			tagsToggle = new ToggleComponent(container);
			tagsToggle.setValue(state.tagsBelowBody);
			tagsToggle.setTooltip(t('kanbanView.content.tagsBelowBodyToggleDesc'));
			tagsToggle.onChange((value) => {
				if (!suppressDirty) {
					options.onDirty();
				}
				state.tagsBelowBody = value;
				notifyChange();
			});
		},
		assign: (value) => {
			state.tagsTemplate = value;
		}
	}) as HTMLInputElement;

	refreshInsertButton();
	notifyChange();

	return {
		update: (value: KanbanCardContentConfig) => {
			suppressDirty = true;
			const snapshot = cloneKanbanContentConfig(value);
			state.titleTemplate = snapshot.titleTemplate;
			state.bodyTemplate = snapshot.bodyTemplate;
			state.tagsTemplate = snapshot.tagsTemplate;
			state.showBody = snapshot.showBody;
			state.tagsBelowBody = snapshot.tagsBelowBody;
			titleInput.value = snapshot.titleTemplate;
			bodyInput.value = snapshot.bodyTemplate;
			tagsInput.value = snapshot.tagsTemplate;
			bodyToggle?.setValue(snapshot.showBody);
			tagsToggle?.setValue(snapshot.tagsBelowBody);
			suppressDirty = false;
			refreshInsertButton();
			notifyChange();
		},
		refresh: () => refreshInsertButton()
	};
}

export { cloneKanbanContentConfig as cloneContentConfig, resolveInitialKanbanContentConfig as resolveInitialContent } from './KanbanContentConfig';

function openFieldMenu(event: MouseEvent, fields: string[], onSelect: (field: string) => void): void {
	const menu = new Menu();
	if (fields.length === 0) {
		menu.addItem((item) => {
			item.setTitle(t('kanbanView.content.noFieldOption'));
			item.setDisabled(true);
		});
		menu.showAtMouseEvent(event);
		return;
	}
	fields
		.slice()
		.sort((a, b) => a.localeCompare(b, getLocaleCode(), { sensitivity: 'base' }))
		.forEach((field) => {
			menu.addItem((item) => {
				item.setTitle(field);
				item.onClick(() => onSelect(field));
			});
		});
	menu.showAtMouseEvent(event);
}

function insertPlaceholder(target: HTMLInputElement | HTMLTextAreaElement, field: string): void {
	const placeholder = wrapPlaceholder(field);
	const start = target.selectionStart ?? target.value.length;
	const end = target.selectionEnd ?? target.value.length;
	const before = target.value.slice(0, start);
	const after = target.value.slice(end);
	target.value = `${before}${placeholder}${after}`;
	const cursor = start + placeholder.length;
	target.selectionStart = cursor;
	target.selectionEnd = cursor;
	target.focus();
	target.dispatchEvent(new Event('input'));
}

function normalizeTemplateInput(value: string): string {
	return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\{\{\s*/g, '{').replace(/\s*\}\}/g, '}');
}
