import { Menu } from 'obsidian';
import { t } from '../../i18n';

interface KanbanBoardMenuOptions {
	event: MouseEvent;
	onEdit: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}

export function showKanbanBoardMenu(options: KanbanBoardMenuOptions): void {
	const menu = new Menu();
	menu.addItem((item) => {
		item
			.setTitle(t('kanbanView.toolbar.editBoardLabel'))
			.setIcon('pencil')
			.onClick(options.onEdit);
	});
	menu.addItem((item) => {
		item
			.setTitle(t('kanbanView.toolbar.duplicateBoardLabel'))
			.setIcon('copy')
			.onClick(options.onDuplicate);
	});
	menu.addItem((item) => {
		item
			.setTitle(t('kanbanView.toolbar.deleteBoardLabel'))
			.setIcon('trash-2')
			.onClick(options.onDelete);
	});
	menu.showAtPosition({
		x: options.event.clientX,
		y: options.event.clientY
	});
}
