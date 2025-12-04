import { Menu } from 'obsidian';
import type { TableView } from '../../TableView';
import { KanbanToolbar } from './KanbanToolbar';
import { t } from '../../i18n';
import { isStatusLaneField } from './statusLaneHelpers';

export function renderKanbanToolbar(view: TableView, container: HTMLElement): void {
	view.globalQuickFilterController.cleanup();
	if (!view.kanbanBoardController) {
		return;
	}

	view.kanbanBoardController.ensureInitialized();
	const boards = view.kanbanBoardController.getBoards();
	const activeBoardId = view.kanbanBoardController.getActiveBoardId();
	view.activeKanbanBoardId = activeBoardId ?? null;

	view.kanbanToolbar = new KanbanToolbar({
		container,
		boards: boards.map((board) => ({
			id: board.id,
			name: board.name,
			icon: board.icon ?? null
		})),
		activeBoardId,
		renderQuickFilter: (searchContainer) => view.globalQuickFilterController.render(searchContainer),
		onSelectBoard: (boardId) => {
			void view.kanbanBoardController.selectBoard(boardId);
		},
		onCreateBoard: () => {
			void view.kanbanBoardController.createBoard();
		},
		onEditBoard: (boardId) => {
			const target = view.kanbanBoardController.getBoards().find((entry) => entry.id === boardId);
			if (target) {
				void view.kanbanBoardController.editBoard(target);
			}
		},
		onOpenBoardMenu: (boardId, event) => {
			const target = view.kanbanBoardController.getBoards().find((entry) => entry.id === boardId);
			if (target) {
				void view.kanbanBoardController.openBoardMenu(target, event);
			}
		},
		onOpenSettings: (button, event) => {
			event.preventDefault();
			const menu = new Menu();
			const laneField = view.kanbanLaneField ?? '';
			const hasLaneField = laneField.trim().length > 0;
			const statusLane = hasLaneField && isStatusLaneField(laneField);
			const canCreateLanePreset = hasLaneField && !statusLane;
			menu.addItem((item) => {
				const baseLabel = t('kanbanView.toolbar.addLanePresetMenuLabel');
				item
					.setTitle(baseLabel)
					.setIcon('plus')
					.onClick(() => {
						if (canCreateLanePreset) {
							void view.kanbanBoardController?.addLanePreset();
						}
					});
				if (!canCreateLanePreset) {
					item.setDisabled(true);
				}
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item
					.setTitle(t('kanbanView.settings.multiRowToggle'))
					.setChecked(view.kanbanMultiRowEnabled)
					.onClick(() => {
						view.setKanbanMultiRowEnabled(!view.kanbanMultiRowEnabled);
					});
			});
			const rect = button.getBoundingClientRect();
			const ownerDoc = button.ownerDocument;
			const win = ownerDoc?.defaultView ?? window;
			menu.showAtPosition({
				x: rect.left + win.scrollX,
				y: rect.bottom + win.scrollY
			});
		}
	});

	view.kanbanBoardController.attachToolbar();
}
