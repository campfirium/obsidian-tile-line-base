import { App, Menu, Notice } from 'obsidian';
import { ROW_ID_FIELD } from '../grid/GridAdapter';
import type { ColumnConfig } from './MarkdownBlockParser';
import type { Schema } from './SchemaBuilder';
import type { TableDataStore } from './TableDataStore';
import type { ColumnLayoutStore } from './ColumnLayoutStore';
import { ColumnEditorModal, type ColumnEditorResult, type ColumnFieldType } from './ColumnEditorModal';

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
		if (!this.getSchema()) {
			return;
		}
		if (!field || field === '#' || field === ROW_ID_FIELD || field === 'status') {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.openColumnHeaderMenu(field, event);
	}

	private openColumnHeaderMenu(field: string, event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle('编辑列').setIcon('pencil').onClick(() => {
				this.openColumnEditModal(field);
			});
		});
		menu.addItem((item) => {
			item.setTitle('复制列').setIcon('copy').onClick(() => {
				this.duplicateColumn(field);
			});
		});
		menu.addItem((item) => {
			item.setTitle('插入列').setIcon('plus').onClick(() => {
				this.insertColumnAfter(field);
			});
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle('删除列').setIcon('trash').onClick(() => {
				this.removeColumn(field);
			});
		});
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	private openColumnEditModal(field: string): void {
		const schema = this.getSchema();
		if (!schema) {
			return;
		}
		const configs = schema.columnConfigs ?? [];
		const existing = configs.find((config) => config.name === field);
		const initialType: ColumnFieldType = existing?.formula?.trim() ? 'formula' : 'text';
		const initialFormula = existing?.formula ?? '';
		const validateName = (name: string): string | null => {
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return '列名称不能为空';
			}
			if (trimmed === field) {
				return null;
			}
			if (trimmed === '#' || trimmed === ROW_ID_FIELD || trimmed === 'status') {
				return '列名已被系统保留';
			}
			if (this.getSchema()?.columnNames?.some((item) => item === trimmed)) {
				return '列名已存在';
			}
			return null;
		};
		const modal = new ColumnEditorModal(this.app, {
			columnName: field,
			initialType,
			initialFormula,
			validateName,
			onSubmit: (result) => {
				this.applyColumnEditResult(field, result);
			},
			onCancel: () => {}
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
				new Notice(`重命名列失败：${targetName}`);
				return;
			}
			this.columnLayoutStore.rename(field, targetName);
			this.renameColumnInFilterViews(field, targetName);
			activeField = targetName;
		}

		const existingConfigs = (schema.columnConfigs ?? []) as ColumnConfig[];
		const nextConfigs = existingConfigs.map((config) => ({ ...config }));
		let config = nextConfigs.find((item) => item.name === activeField);
		if (!config) {
			config = { name: activeField };
			nextConfigs.push(config);
		}

		if (result.type === 'formula') {
			config.formula = result.formula;
		} else {
			delete config.formula;
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
			new Notice('复制列失败，请稍后重试');
			return;
		}
		this.columnLayoutStore.clone(field, newName);
		this.persistColumnStructureChange({ notice: `已复制列：${newName}` });
		this.openColumnEditModal(newName);
	}

	private insertColumnAfter(field: string): void {
		if (!this.getSchema()) {
			return;
		}
		const newName = this.dataStore.insertColumnAfter(field);
		if (!newName) {
			new Notice('插入新列失败，请稍后重试');
			return;
		}
		this.persistColumnStructureChange({ notice: `已插入列：${newName}` });
		this.openColumnEditModal(newName);
	}

	private removeColumn(field: string): void {
		if (!this.getSchema()) {
			return;
		}
		const target = field.trim();
		if (!target || target === '#' || target === 'status' || target === ROW_ID_FIELD) {
			return;
		}
		const removed = this.dataStore.removeColumn(target);
		if (!removed) {
			return;
		}
		this.columnLayoutStore.remove(target);
		this.removeColumnFromFilterViews(target);
		this.persistColumnStructureChange({ notice: `已删除列：${target}` });
	}
}
