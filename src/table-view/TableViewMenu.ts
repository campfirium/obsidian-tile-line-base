import type { Menu } from 'obsidian';
import { t } from '../i18n';
import type { TableView } from '../TableView';

interface MenuEntry {
	label: string;
	icon: string;
	order: number;
	onClick: () => void;
}

interface MenuGroup {
	order: number;
	items: MenuEntry[];
}

function getMenuItemCount(menu: Menu): number {
	const items = (menu as unknown as { items?: unknown[] }).items;
	return Array.isArray(items) ? items.length : 0;
}

function buildViewModeEntries(view: TableView): MenuEntry[] {
	const modes: Array<{ mode: 'table' | 'kanban' | 'slide'; label: string; icon: string; order: number }> = [
		{ mode: 'table', label: t('kanbanView.actions.switchToTable'), icon: 'table', order: 1 },
		{ mode: 'kanban', label: t('kanbanView.actions.switchToKanban'), icon: 'layout-kanban', order: 2 },
		{ mode: 'slide', label: t('slideView.actions.switchToSlide'), icon: 'presentation', order: 3 }
	];
	return modes
		.filter((entry) => view.activeViewMode !== entry.mode)
		.map((entry) => ({
			label: entry.label,
			icon: entry.icon,
			order: entry.order,
			onClick: () => {
				void view.setActiveViewMode(entry.mode);
			}
		}));
}

export function populateMoreOptionsMenu(view: TableView, menu: Menu): void {
	const groups: MenuGroup[] = [
		{
			order: 1,
			items: buildViewModeEntries(view)
		}
	];

	const hasExistingItems = getMenuItemCount(menu) > 0;
	let hasAddedGroup = false;

	for (const group of groups.sort((a, b) => a.order - b.order)) {
		const items = group.items.sort((a, b) => a.order - b.order);
		if (items.length === 0) {
			continue;
		}
		if (hasExistingItems || hasAddedGroup) {
			menu.addSeparator();
		}
		for (const entry of items) {
			menu.addItem((item) => {
				item
					.setTitle(entry.label)
					.setIcon(entry.icon)
					.onClick(entry.onClick);
			});
		}
		hasAddedGroup = true;
	}
}
