import { setIcon } from 'obsidian';
import { t } from '../../i18n';

export interface KanbanToolbarBoard {
	id: string;
	name: string;
	icon?: string | null;
}

interface KanbanToolbarOptions {
	container: Element;
	boards: KanbanToolbarBoard[];
	activeBoardId: string | null;
	renderQuickFilter: (container: HTMLElement) => void;
	onSelectBoard: (boardId: string) => void | Promise<void>;
	onCreateBoard: () => void | Promise<void>;
	onEditBoard: (boardId: string) => void | Promise<void>;
	onOpenBoardMenu: (boardId: string, event: MouseEvent) => void | Promise<void>;
	onOpenSettings: (button: HTMLButtonElement, event: MouseEvent) => void;
}

interface ListenerEntry {
	id: string;
	button: HTMLButtonElement;
	clickHandler: (event: MouseEvent) => void;
	contextHandler: (event: MouseEvent) => void;
	doubleClickHandler: (event: MouseEvent) => void;
}

export class KanbanToolbar {
	private readonly rootEl: HTMLElement;
	private readonly tabsEl: HTMLElement;
	private readonly boardListEl: HTMLElement;
	private readonly searchEl: HTMLElement;
	private readonly actionsEl: HTMLElement;
	private readonly addButtonEl: HTMLButtonElement;
	private readonly settingsButtonEl: HTMLButtonElement;
	private readonly addClickHandler: (event: MouseEvent) => void;
	private readonly settingsClickHandler: (event: MouseEvent) => void;
	private readonly boardListeners: ListenerEntry[] = [];
	private boards: KanbanToolbarBoard[] = [];
	private activeBoardId: string | null;

	constructor(private readonly options: KanbanToolbarOptions) {
		this.activeBoardId = options.activeBoardId ?? null;
		this.rootEl = options.container.createDiv({ cls: 'tlb-filter-view-bar tlb-kanban-toolbar' });
		this.tabsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-tabs' });
		this.boardListEl = this.tabsEl.createDiv({ cls: 'tlb-kanban-toolbar__boards' });

		const addLabel = t('kanbanView.toolbar.addBoardButtonAriaLabel');
		this.addButtonEl = this.tabsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--add',
			text: '+'
		});
		this.addButtonEl.setAttribute('type', 'button');
		this.addButtonEl.setAttribute('aria-label', addLabel);
		this.addButtonEl.setAttribute('title', addLabel);
		this.addClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			void this.options.onCreateBoard();
		};
		this.addButtonEl.addEventListener('click', this.addClickHandler);

		this.searchEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-search' });
		this.options.renderQuickFilter(this.searchEl);

		this.actionsEl = this.rootEl.createDiv({ cls: 'tlb-filter-view-actions' });
		this.settingsButtonEl = this.actionsEl.createEl('button', {
			cls: 'tlb-filter-view-button tlb-filter-view-button--settings'
		});
		this.settingsButtonEl.setAttribute('type', 'button');
		const settingsLabel = t('filterViewBar.settingsMenuAriaLabel');
		this.settingsButtonEl.setAttribute('aria-label', settingsLabel);
		this.settingsButtonEl.setAttribute('title', settingsLabel);
		setIcon(this.settingsButtonEl, 'settings');
		this.settingsClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.options.onOpenSettings(this.settingsButtonEl, event);
		};
		this.settingsButtonEl.addEventListener('click', this.settingsClickHandler);

		this.updateState(options.boards, options.activeBoardId ?? null);
	}

	updateState(boards: KanbanToolbarBoard[], activeBoardId: string | null): void {
		this.boards = boards.map((board) => ({
			id: board.id,
			name: board.name,
			icon: board.icon ?? null
		}));
		this.activeBoardId = activeBoardId ?? (this.boards[0]?.id ?? null);
		this.renderBoardButtons();
	}

	destroy(): void {
		for (const entry of this.boardListeners) {
			entry.button.removeEventListener('click', entry.clickHandler);
			entry.button.removeEventListener('contextmenu', entry.contextHandler);
			entry.button.removeEventListener('dblclick', entry.doubleClickHandler);
		}
		this.boardListeners.length = 0;
		this.addButtonEl.removeEventListener('click', this.addClickHandler);
		this.settingsButtonEl.removeEventListener('click', this.settingsClickHandler);
		this.rootEl.remove();
	}

	setActiveBoard(boardId: string | null): void {
		this.activeBoardId = boardId ?? null;
		for (const entry of this.boardListeners) {
			if (this.activeBoardId && entry.id === this.activeBoardId) {
				entry.button.classList.add('is-active');
			} else {
				entry.button.classList.remove('is-active');
			}
		}
	}

	private renderBoardButtons(): void {
		this.boardListEl.empty();
		for (const entry of this.boardListeners) {
			entry.button.removeEventListener('click', entry.clickHandler);
			entry.button.removeEventListener('contextmenu', entry.contextHandler);
			entry.button.removeEventListener('dblclick', entry.doubleClickHandler);
		}
		this.boardListeners.length = 0;

		for (const board of this.boards) {
			const button = this.boardListEl.createEl('button', {
				cls: 'tlb-filter-view-button',
				attr: { 'data-board-id': board.id }
			});
			button.setAttribute('type', 'button');
			const label = this.resolveLabel(board.name);
			this.applyButtonContent(button, label, board.icon ?? null);

			if (this.isActive(board.id)) {
				button.classList.add('is-active');
			}

			const clickHandler = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				this.setActiveBoard(board.id);
				void this.options.onSelectBoard(board.id);
			};

			const contextHandler = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void this.options.onOpenBoardMenu(board.id, event);
			};

			const doubleClickHandler = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void this.options.onEditBoard(board.id);
			};

			button.addEventListener('click', clickHandler);
			button.addEventListener('contextmenu', contextHandler);
			button.addEventListener('dblclick', doubleClickHandler);

			this.boardListeners.push({
				id: board.id,
				button,
				clickHandler,
				contextHandler,
				doubleClickHandler
			});
		}

		if (this.activeBoardId === null && this.boardListeners.length > 0) {
			this.setActiveBoard(this.boardListeners[0].id);
		}
	}

	private resolveLabel(name: string): string {
		const trimmed = typeof name === 'string' ? name.trim() : '';
		return trimmed.length > 0 ? trimmed : t('kanbanView.toolbar.unnamedBoardLabel');
	}

	private applyButtonContent(button: HTMLButtonElement, label: string, iconId: string | null): void {
		button.empty();
		button.setAttribute('title', label);
		button.setAttribute('aria-label', label);
		const sanitizedIcon = typeof iconId === 'string' ? iconId.trim() : '';
		if (sanitizedIcon.length === 0) {
			button.textContent = label;
			return;
		}
		const iconEl = button.createSpan({ cls: 'tlb-filter-view-button__icon' });
		setIcon(iconEl, sanitizedIcon);
		if (!iconEl.querySelector('svg')) {
			iconEl.remove();
			button.textContent = label;
			return;
		}
		const nameEl = button.createSpan({ cls: 'tlb-filter-view-button__label' });
		nameEl.textContent = label;
	}

	private isActive(boardId: string): boolean {
		return this.activeBoardId !== null && boardId === this.activeBoardId;
	}
}
