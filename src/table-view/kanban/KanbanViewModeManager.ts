import { Notice, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { TableView } from '../../TableView';
import { hasKanbanLaneSources } from './KanbanLaneResolver';

type ViewMode = 'table' | 'kanban';

export class KanbanViewModeManager {
	private readonly actionId = 'toggle-kanban-view';
	private toggleButton: HTMLElement | null = null;
	private toggleIconEl: HTMLElement | SVGElement | null = null;
	private isSwitching = false;

	constructor(private readonly view: TableView) {}

	ensureToggle(): void {
		if (this.toggleButton) {
			return;
		}
		const label = this.getToggleLabel();
		const button = this.view.addAction('layout-kanban', label, async (evt) => {
			const targetMode: ViewMode = this.view.activeViewMode === 'kanban' ? 'table' : 'kanban';
			evt?.preventDefault();
			evt?.stopPropagation();
			await this.setActiveViewMode(targetMode);
		});
		const iconEl = (button as any).iconEl ?? (button as any).containerEl ?? (button as any);
		this.toggleButton = button;
		this.toggleIconEl = iconEl ?? null;
		this.applyToggleIcon();
		button.setAttribute('data-tlb-action', this.actionId);
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
	}

	detachToggle(): void {
		if (this.toggleButton) {
			this.toggleButton.remove();
			this.toggleButton = null;
		}
		this.toggleIconEl = null;
	}

	updateToggleButton(): void {
		if (!this.toggleButton) {
			return;
		}
		const label = this.getToggleLabel();
		this.toggleButton.setAttribute('aria-label', label);
		this.toggleButton.setAttribute('title', label);
		this.applyToggleIcon();
	}

	async setActiveViewMode(mode: ViewMode): Promise<void> {
		if (this.isSwitching) {
			return;
		}
		if (mode === this.view.activeViewMode) {
			this.updateToggleButton();
			return;
		}

		if (mode === 'kanban') {
			const ready = this.ensureLaneSources();
			if (!ready) {
				this.updateToggleButton();
				return;
			}
		}

		this.isSwitching = true;
		try {
			this.view.activeViewMode = mode;
			this.updateToggleButton();
			void this.view.persistenceService?.saveConfig();
			await this.view.render();
		} finally {
			this.isSwitching = false;
		}
	}

	async handleAfterRender(): Promise<ViewMode | null> {
		if (this.view.activeViewMode !== 'kanban') {
			return null;
		}

		if (!hasKanbanLaneSources(this.view)) {
			new Notice(t('kanbanView.laneSourceRequired'));
			this.view.activeViewMode = 'table';
			this.updateToggleButton();
			void this.view.persistenceService?.saveConfig();
			return 'table';
		}

		return null;
	}

	private getToggleLabel(): string {
		return this.view.activeViewMode === 'kanban'
			? t('kanbanView.actions.switchToTable')
			: t('kanbanView.actions.switchToKanban');
	}

<<<<<<< HEAD
	private applyToggleIcon(): void {
		const iconEl = this.toggleIconEl;
		if (!iconEl) {
			return;
		}
		const target = iconEl as HTMLElement;

		const iconCandidates =
			this.view.activeViewMode === 'kanban'
				? ['tilelinebase-table', 'table', 'layout-grid']
				: ['layout-kanban', 'layout-grid'];

		for (const iconId of iconCandidates) {
			setIcon(target, iconId);
			if (target.querySelector?.('svg')) {
				break;
			}
		}
	}

	private hasValidLaneField(): boolean {
		const schema = this.view.schema;
		if (!schema || !Array.isArray(schema.columnNames)) {
			return false;
		}
		const laneField = this.view.kanbanLaneField;
		return typeof laneField === 'string' && schema.columnNames.includes(laneField);
	}

	private async promptForLaneField(): Promise<boolean> {
		const schema = this.view.schema;
		if (!schema || !Array.isArray(schema.columnNames)) {
			new Notice(t('kanbanView.fieldModal.schemaUnavailable'));
			return false;
		}

		const columns = schema.columnNames.filter((name) => {
			if (!name || typeof name !== 'string') {
				return false;
			}
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return false;
			}
			if (trimmed === '#' || trimmed === '__tlb_row_id') {
				return false;
			}
			return true;
		});

		if (columns.length === 0) {
			new Notice(t('kanbanView.fieldModal.noColumns'));
			return false;
		}

		const selected = await new Promise<string | null>((resolve) => {
			const modal = new KanbanFieldModal(this.view.app, {
				columns,
				initial: this.view.kanbanLaneField,
				onSubmit: (field) => resolve(field),
				onCancel: () => resolve(null)
			});
			modal.open();
		});

		if (!selected) {
			return false;
		}

		this.view.kanbanLaneField = selected;
		this.updateToggleButton();
		void this.view.persistenceService?.saveConfig();
		return true;
	}

	private ensureSortField(): boolean {
		const schema = this.view.schema;
		if (!schema || !Array.isArray(schema.columnNames) || schema.columnNames.length === 0) {
			return false;
		}

		const desiredName = this.view.kanbanSortField ?? '看板排序';
		if (schema.columnNames.includes(desiredName)) {
			this.view.kanbanSortField = desiredName;
			return false;
		}

		const referenceField =
			this.view.kanbanLaneField ?? schema.columnNames[schema.columnNames.length - 1] ?? null;
		if (!referenceField) {
			return false;
		}

		const created = this.view.dataStore.insertColumnAfter(referenceField, desiredName);
		if (created) {
			this.view.kanbanSortField = created;
			this.view.persistenceService?.scheduleSave();
=======
	private ensureLaneSources(): boolean {
		if (hasKanbanLaneSources(this.view)) {
>>>>>>> feat/T0140-kanban-conversion
			return true;
		}
		new Notice(t('kanbanView.laneSourceRequired'));
		return false;
	}
}
