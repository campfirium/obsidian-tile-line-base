import { App, Menu, Notice } from 'obsidian';
import { ROW_ID_FIELD } from '../grid/GridAdapter';
import { isDisplayedSystemColumn, isReservedColumnId } from '../grid/systemColumnUtils';
import type { ColumnConfig } from './MarkdownBlockParser';
import type { Schema } from './SchemaBuilder';
import type { TableDataStore } from './TableDataStore';
import type { ColumnLayoutStore } from './ColumnLayoutStore';
import { ColumnEditorModal, type ColumnEditorResult, type ColumnFieldType } from './ColumnEditorModal';
import { t } from '../i18n';

interface ColumnInteractionDeps {
	app: App;
	dataStore: TableDataStore;
	columnLayoutStore: ColumnLayoutStore;
	getSchema: () => Schema | null;
	renameColumnInFilterViews: (oldName: string, newName: string) => void;
	removeColumnFromFilterViews: (name: string) => void;
	persistColumnStructureChange: (options?: { notice?: string }) => void;
}

export class ColumnInteractionController {
	private readonly app: App;
	private readonly dataStore: TableDataStore;
	private readonly columnLayoutStore: ColumnLayoutStore;
	private readonly getSchema: () => Schema | null;
	private readonly renameColumnInFilterViews: (oldName: string, newName: string) => void;
	private readonly removeColumnFromFilterViews: (name: string) => void;
	private readonly persistColumnStructureChange: (options?: { notice?: string }) => void;

	constructor(deps: ColumnInteractionDeps) {
		this.app = deps.app;
		this.dataStore = deps.dataStore;
		this.columnLayoutStore = deps.columnLayoutStore;
		this.getSchema = deps.getSchema;
		this.renameColumnInFilterViews = deps.renameColumnInFilterViews;
		this.removeColumnFromFilterViews = deps.removeColumnFromFilterViews;
		this.persistColumnStructureChange = deps.persistColumnStructureChange;
	}

	handleColumnHeaderContextMenu(field: string, event: MouseEvent): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}
		if (!field || field === ROW_ID_FIELD) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		if (field === '#') {
			this.openIndexHeaderMenu(event);
			return;
		}

		if (field === 'status') {
			this.openStatusColumnMenu(event);
			return;
		}

		if (isDisplayedSystemColumn(field)) {
			return;
		}

		this.openColumnHeaderMenu(field, event);
	}

	private openColumnHeaderMenu(field: string, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(t('columnInteraction.menuEdit')).setIcon('pencil').onClick(() => {
				this.openColumnEditModal(field);
			});
		});
		menu.addItem((item) => {
			item.setTitle(t('columnInteraction.menuDuplicate')).setIcon('copy').onClick(() => {
				this.duplicateColumn(field);
			});
		});
		menu.addItem((item) => {
			item.setTitle(t('columnInteraction.menuInsert')).setIcon('plus').onClick(() => {
				this.insertColumnAfter(field);
			});
		});
		menu.addItem((item) => {
			item.setTitle(t('columnInteraction.menuHide')).setIcon('eye-off').onClick(() => {
				this.setColumnHidden(field, true);
			});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle(t('columnInteraction.menuDelete')).setIcon('trash').onClick(() => {
				this.removeColumn(field);
			});
		});
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	private openStatusColumnMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(t('columnInteraction.menuHide')).setIcon('eye-off').onClick(() => {
				this.setColumnHidden('status', true);
			});
		});
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	private openIndexHeaderMenu(event: MouseEvent): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}

		const hiddenSet = new Set(
			(schema.columnConfigs ?? []).filter((config) => config.hide).map((config) => config.name)
		);
		const hiddenColumns = schema.columnNames.filter((name) => hiddenSet.has(name));

		const menu = new Menu();
		if (hiddenColumns.length === 0) {
			menu.addItem((item) => {
				item.setTitle(t('columnVisibility.empty')).setDisabled(true);
			});
			menu.showAtPosition({ x: event.pageX, y: event.pageY });
			return;
		}

		menu.addItem((item) => {
			item.setTitle(t('columnVisibility.menuTitle')).setIcon('eye').onClick(() => {
				this.openHiddenColumnChooser(hiddenColumns, {
					x: event.pageX + 12,
					y: event.pageY + 12
				});
			});
		});
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	private openHiddenColumnChooser(hiddenColumns: string[], anchor: { x: number; y: number }): void {
		if (hiddenColumns.length === 0) {
			return;
		}
		const menu = new Menu();
		for (const columnName of hiddenColumns) {
			menu.addItem((item) => {
				item.setTitle(columnName).setIcon('eye').onClick(() => {
					this.setColumnHidden(columnName, false);
				});
			});
		}
		menu.showAtPosition(anchor);
	}

	private openColumnEditModal(field: string): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}
		const configs = schema.columnConfigs ?? [];
		const existing = configs.find((config) => config.name === field);
		const initialType: ColumnFieldType = existing?.formula?.trim()
			? 'formula'
			: existing?.type === 'date'
				? 'date'
				: 'text';
		const initialFormula = existing?.formula ?? '';
		const initialDateFormat = existing?.type === 'date' ? existing.dateFormat ?? 'iso' : undefined;
		const availableFields = schema.columnNames.filter((name) => name && !isReservedColumnId(name));
		const validateName = (name: string): string | null => {
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return t('columnInteraction.nameEmptyError');
			}
			if (trimmed === field) {
				return null;
			}
			if (isReservedColumnId(trimmed)) {
				return t('columnInteraction.nameReservedError');
			}
			if (this.getSchema()?.columnNames?.some((item) => item === trimmed)) {
				return t('columnInteraction.nameExistsError');
			}
			return null;
		};
		const modal = new ColumnEditorModal(this.app, {
			columnName: field,
			initialType,
			initialFormula,
			initialDateFormat,
			validateName,
			availableFields,
			onSubmit: (result) => {
				this.applyColumnEditResult(field, result);
			},
			onCancel: () => undefined
		});
		modal.open();
	}

	private applyColumnEditResult(field: string, result: ColumnEditorResult): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}

		const trimmedName = result.name.trim();
		const targetName = trimmedName.length > 0 ? trimmedName : field;
		const nameChanged = targetName !== field;
		let activeField = field;

		if (nameChanged) {
			const renamed = this.dataStore.renameColumn(field, targetName);
			if (!renamed) {
				new Notice(t('columnInteraction.renameFailed', { target: targetName }));
				return;
			}
			this.columnLayoutStore.rename(field, targetName);
			this.renameColumnInFilterViews(field, targetName);
			activeField = targetName;
		}

		const existingConfigs = (schema.columnConfigs ?? []) as ColumnConfig[];
		const previousConfig = existingConfigs.find((item) => item.name === activeField) ?? null;
		const nextConfigs = existingConfigs.map((config) => ({ ...config }));
		let config = nextConfigs.find((item) => item.name === activeField);
		if (!config) {
			config = { name: activeField };
			nextConfigs.push(config);
		}

		if (result.type === 'formula') {
			config.formula = result.formula;
			delete config.type;
			delete config.dateFormat;
		} else if (result.type === 'date') {
			delete config.formula;
			config.type = 'date';
			const preset = result.dateFormat ?? 'iso';
			if (preset === 'iso') {
				delete config.dateFormat;
			} else {
				config.dateFormat = preset;
			}
		} else {
			delete config.formula;
			delete config.dateFormat;
			if (previousConfig?.type === 'date' || previousConfig?.type === 'text') {
				config.type = 'text';
			} else {
				delete config.type;
			}
		}

		if (!this.dataStore.hasColumnConfigContent(config)) {
			const index = nextConfigs.findIndex((item) => item.name === activeField);
			if (index !== -1) {
				nextConfigs.splice(index, 1);
			}
		}

		const normalized = this.dataStore.normalizeColumnConfigs(nextConfigs);
		schema.columnConfigs = normalized;
		this.dataStore.setColumnConfigs(normalized);
		this.persistColumnStructureChange();
	}

	private duplicateColumn(field: string): void {
		if (!this.getSchema()) {
			return;
		}
		const newName = this.dataStore.duplicateColumn(field);
		if (!newName) {
			new Notice(t('columnInteraction.duplicateFailed'));
			return;
		}
		this.columnLayoutStore.clone(field, newName);
		this.persistColumnStructureChange({ notice: t('columnInteraction.duplicateSuccess', { name: newName }) });
		this.openColumnEditModal(newName);
	}

	private insertColumnAfter(field: string): void {
		if (!this.getSchema()) {
			return;
		}
		const newName = this.dataStore.insertColumnAfter(field);
		if (!newName) {
			new Notice(t('columnInteraction.insertFailed'));
			return;
		}
		this.persistColumnStructureChange({ notice: t('columnInteraction.insertSuccess', { name: newName }) });
		this.openColumnEditModal(newName);
	}

	private removeColumn(field: string): void {
		if (!this.getSchema()) {
			return;
		}
		const target = field.trim();
		if (!target || isReservedColumnId(target)) {
			return;
		}
		const removed = this.dataStore.removeColumn(target);
		if (!removed) {
			return;
		}
		this.columnLayoutStore.remove(target);
		this.removeColumnFromFilterViews(target);
		this.persistColumnStructureChange({ notice: t('columnInteraction.deleteSuccess', { name: target }) });
	}

	private setColumnHidden(field: string, hidden: boolean): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}
		const target = field.trim();
		if (!target || isReservedColumnId(target)) {
			return;
		}

		const existingConfigs = (schema.columnConfigs ?? []) as ColumnConfig[];
		const nextConfigs = existingConfigs.map((config) => ({ ...config }));
		let config = nextConfigs.find((item) => item.name === target);

		if (!config && hidden) {
			config = { name: target };
			nextConfigs.push(config);
		}

		if (!config) {
			return;
		}
		if (hidden && config.hide) {
			return;
		}
		if (!hidden && !config.hide) {
			return;
		}

		if (hidden) {
			config.hide = true;
		} else {
			delete config.hide;
		}

		if (!this.dataStore.hasColumnConfigContent(config)) {
			const index = nextConfigs.findIndex((item) => item.name === target);
			if (index !== -1) {
				nextConfigs.splice(index, 1);
			}
		}

		const normalized = this.dataStore.normalizeColumnConfigs(nextConfigs);
		schema.columnConfigs = normalized;
		this.dataStore.setColumnConfigs(normalized);

		const noticeKey = hidden ? 'columnVisibility.hideNotice' : 'columnVisibility.showNotice';
		this.persistColumnStructureChange({ notice: t(noticeKey, { name: target }) });
	}
}
