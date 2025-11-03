import { Notice, setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { TableView } from '../../TableView';
import { hasKanbanLaneSources } from './KanbanLaneResolver';

type ViewMode = 'table' | 'kanban';

export class KanbanViewModeManager {
	private readonly actionId = 'toggle-kanban-view';
	private toggleButton: HTMLElement | null = null;
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
		setIcon(iconEl, 'layout-kanban');
		const svg = iconEl?.querySelector?.('svg');
		if (!svg) {
			setIcon(iconEl, 'layout-grid');
		}
		button.setAttribute('data-tlb-action', this.actionId);
		button.setAttribute('aria-label', label);
		button.setAttribute('title', label);
		this.toggleButton = button;
	}

	detachToggle(): void {
		if (this.toggleButton) {
			this.toggleButton.remove();
			this.toggleButton = null;
		}
	}

	updateToggleButton(): void {
		if (!this.toggleButton) {
			return;
		}
		const label = this.getToggleLabel();
		this.toggleButton.setAttribute('aria-label', label);
		this.toggleButton.setAttribute('title', label);
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

	private ensureLaneSources(): boolean {
		if (hasKanbanLaneSources(this.view)) {
			return true;
		}
		new Notice(t('kanbanView.laneSourceRequired'));
		return false;
	}
}
