import { Menu } from 'obsidian';
import type { TableView } from '../../TableView';
import { KanbanToolbar } from './KanbanToolbar';
import { t } from '../../i18n';

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
			menu.addItem((item) => {
				item
					.setTitle(t('kanbanView.settings.heightAuto'))
					.setChecked(view.kanbanHeightMode === 'auto')
					.onClick(() => {
						view.setKanbanHeightMode('auto');
					});
			});
			menu.addItem((item) => {
				item
					.setTitle(t('kanbanView.settings.heightViewport'))
					.setChecked(view.kanbanHeightMode === 'viewport')
					.onClick(() => {
						view.setKanbanHeightMode('viewport');
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
