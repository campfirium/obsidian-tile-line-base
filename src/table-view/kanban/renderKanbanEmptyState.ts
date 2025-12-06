import { t } from '../../i18n';

export function renderKanbanEmptyState(container: HTMLElement, isFiltered: boolean): void {
	const empty = container.createDiv({ cls: 'tlb-kanban-empty' });
	const icon = empty.createSpan({ cls: 'tlb-kanban-empty__icon' });
	icon.setText('棣冩惖');
	const label = empty.createSpan({ cls: 'tlb-kanban-empty__label' });
	label.setText(isFiltered ? t('kanbanView.emptyStateFiltered') : t('kanbanView.emptyState'));
}
