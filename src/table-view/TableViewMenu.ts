import type { Menu } from 'obsidian';
import { t } from '../i18n';
import { getPluginContext } from '../pluginContext';
import type { TableView } from '../TableView';

export function populateMoreOptionsMenu(view: TableView, menu: Menu): void {
	const plugin = getPluginContext();
	if (!plugin) {
		return;
	}
	const modes: Array<{ mode: 'table' | 'kanban' | 'slide'; label: string; icon: string }> = [
		{ mode: 'table', label: t('kanbanView.actions.switchToTable'), icon: 'table' },
		{ mode: 'kanban', label: t('kanbanView.actions.switchToKanban'), icon: 'layout-kanban' },
		{ mode: 'slide', label: t('slideView.actions.switchToSlide'), icon: 'presentation' }
	];
	for (const entry of modes) {
		if (view.activeViewMode === entry.mode) {
			continue;
		}
		menu.addItem((item) => {
			item
				.setTitle(entry.label)
				.setIcon(entry.icon)
				.onClick(() => {
					void view.setActiveViewMode(entry.mode);
				});
		});
	}
	menu.addItem((item) => {
		item
			.setTitle(t('commands.openHelpDocument'))
			.setIcon('info')
			.onClick(() => {
				void plugin.openHelpDocument();
			});
	});
}
