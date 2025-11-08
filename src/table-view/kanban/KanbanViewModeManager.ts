import { Notice, setIcon } from 'obsidian';
import { t } from '../../i18n';
import { KanbanFieldModal } from './KanbanFieldModal';
import { DEFAULT_KANBAN_SORT_DIRECTION } from '../../types/kanban';
import type { TableView } from '../../TableView';
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

		if (mode === 'kanban' && this.view.schema) {
			const hasBoards = (this.view.kanbanBoardController?.getBoards().length ?? 0) > 0;
			if (!this.hasValidLaneField() && hasBoards) {
				const configured = await this.promptForLaneField();
				if (!configured) {
					this.updateToggleButton();
					return;
				}
			}
			this.ensureSortConfiguration();
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
		if (this.view.activeViewMode !== 'kanban' || !this.view.schema) {
			return null;
		}

		const hasBoards = (this.view.kanbanBoardController?.getBoards().length ?? 0) > 0;
		if (!this.hasValidLaneField()) {
			if (!hasBoards) {
				this.view.kanbanBoardController?.ensureBoardForActiveKanbanView();
				return null;
			}

			const configured = await this.promptForLaneField();
			if (configured) {
				this.ensureSortConfiguration();
				this.view.kanbanBoardController?.ensureBoardForActiveKanbanView();
				return 'kanban';
			}
			this.view.activeViewMode = 'table';
			this.updateToggleButton();
			void this.view.persistenceService?.saveConfig();
			return 'table';
		}

		this.ensureSortConfiguration();
		this.view.kanbanBoardController?.ensureBoardForActiveKanbanView();
		return null;
	}

	private getToggleLabel(): string {
		return this.view.activeViewMode === 'kanban'
			? t('kanbanView.actions.switchToTable')
			: t('kanbanView.actions.switchToKanban');
	}

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

	private ensureSortConfiguration(): void {
		const currentField =
			typeof this.view.kanbanSortField === 'string' ? this.view.kanbanSortField.trim() : '';
		this.view.kanbanSortField = currentField.length > 0 ? currentField : null;
		const direction = this.view.kanbanSortDirection;
		if (direction !== 'asc' && direction !== 'desc') {
			this.view.kanbanSortDirection = DEFAULT_KANBAN_SORT_DIRECTION;
		}
	}

}
