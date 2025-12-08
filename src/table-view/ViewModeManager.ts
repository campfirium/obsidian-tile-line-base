import { Notice, setIcon } from 'obsidian';
import { t } from '../i18n';
import { KanbanFieldModal } from './kanban/KanbanFieldModal';
import { DEFAULT_KANBAN_SORT_DIRECTION } from '../types/kanban';
import type { TableView } from '../TableView';

export type ViewMode = 'table' | 'kanban' | 'slide' | 'gallery';

const MODE_ICONS: Record<ViewMode, string[]> = {
	table: ['tilelinebase-table', 'table', 'layout-grid'],
	kanban: ['layout-kanban', 'layout-grid'],
	slide: ['presentation', 'slideshow', 'play', 'monitor'],
	gallery: ['images', 'gallery', 'layout-grid']
};

export class ViewModeManager {
	private readonly actionIds: Record<ViewMode, string> = {
		table: 'switch-table-view',
		kanban: 'switch-kanban-view',
		slide: 'switch-slide-view',
		gallery: 'switch-gallery-view'
	};
	private buttons: Partial<Record<ViewMode, HTMLElement>> = {};
	private isSwitching = false;

	constructor(private readonly view: TableView) {}

	ensureActions(): void {
		(['table', 'kanban', 'slide', 'gallery'] as ViewMode[]).forEach((mode) => {
			if (this.buttons[mode]) {
				return;
			}
			const label = this.getModeLabel(mode);
			const button = this.view.addAction(MODE_ICONS[mode][0] ?? 'layout-grid', label, (evt) => {
				evt?.preventDefault();
				evt?.stopPropagation();
				void this.setActiveViewMode(mode);
			});
			const iconEl = (button as any).iconEl ?? (button as any).containerEl ?? (button as any);
			for (const icon of MODE_ICONS[mode]) {
				setIcon(iconEl, icon);
				if (iconEl?.querySelector?.('svg')) break;
			}
			button.setAttribute('data-tlb-action', this.actionIds[mode]);
			button.setAttribute('aria-label', label);
			button.setAttribute('title', label);
			this.buttons[mode] = button;
		});
		this.updateButtons();
	}

	detachActions(): void {
		Object.values(this.buttons).forEach((button) => button?.remove());
		this.buttons = {};
	}

	updateButtons(): void {
		(['table', 'kanban', 'slide', 'gallery'] as ViewMode[]).forEach((mode) => {
			const button = this.buttons[mode];
			if (!button) return;
			const isActive = this.view.activeViewMode === mode;
			button.toggleClass('is-active', isActive);
			button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
		});
	}

	async setActiveViewMode(mode: ViewMode): Promise<void> {
		if (this.isSwitching) {
			return;
		}
		if (mode === this.view.activeViewMode) {
			this.updateButtons();
			return;
		}

		if (mode === 'slide' && this.view.activeViewMode !== 'slide') {
			this.view.previousNonSlideMode = this.view.activeViewMode;
		}

		if (mode === 'kanban' && this.view.schema) {
			const hasBoards = (this.view.kanbanBoardController?.getBoards().length ?? 0) > 0;
			if (!this.hasValidLaneField() && hasBoards) {
				const configured = await this.promptForLaneField();
				if (!configured) {
					this.updateButtons();
					return;
				}
			}
			this.ensureSortConfiguration();
		}

		this.isSwitching = true;
		try {
			this.view.activeViewMode = mode;
			this.view.refreshDisplayText();
			this.updateButtons();
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
			this.view.refreshDisplayText();
			this.updateButtons();
			void this.view.persistenceService?.saveConfig();
			return 'table';
		}

		this.ensureSortConfiguration();
		this.view.kanbanBoardController?.ensureBoardForActiveKanbanView();
		return null;
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
		this.updateButtons();
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

	private getModeLabel(mode: ViewMode): string {
		switch (mode) {
			case 'kanban':
				return t('tableView.mode.kanban');
			case 'slide':
				return t('tableView.mode.slide');
			case 'gallery':
				return t('tableView.mode.gallery');
			default:
				return t('tableView.mode.table');
		}
	}
}
