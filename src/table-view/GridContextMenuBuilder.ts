import { Menu } from 'obsidian';
import { t } from '../i18n';

interface MenuBuilderOptions {
	isIndexColumn: boolean;
	isMultiSelect: boolean;
	selectedRowCount: number;
	promotionCount?: number;
	fillSelectionLabelParams?: Record<string, string>;
	undoRedo?: {
		canUndo: boolean;
		canRedo: boolean;
		onUndo: () => void;
		onRedo: () => void;
	};
	cellMenu?: {
		copy?: () => void;
		paste?: () => void;
		disablePaste?: boolean;
	};
	actions: {
		copySelection?: () => void;
		copySelectionAsTemplate: () => void;
		editCopyTemplate: () => void;
		migrateSelection?: {
			moveToNew: () => void;
			copyToNew: () => void;
			moveToExisting: () => void;
		};
		promoteToNote?: () => void;
		insertAbove: () => void;
		insertBelow: () => void;
		fillSelectionWithValue?: () => void;
		duplicateSelection: () => void;
		deleteSelection: () => void;
		duplicateRow: () => void;
		deleteRow: () => void;
		close: () => void;
	};
}

interface MenuItemConfig {
	danger?: boolean;
	params?: Record<string, string>;
	disabled?: boolean;
}

function withClose(handler: () => void, close: () => void): () => void {
	return () => {
		handler();
		close();
	};
}

export function buildGridContextMenu(options: MenuBuilderOptions): Menu {
	const menu = new Menu();
	let activeSubmenu: Menu | null = null;

	const addItem = (
		labelKey: Parameters<typeof t>[0],
		icon: string,
		handler: (() => void) | undefined,
		config?: MenuItemConfig
	): void => {
		if (!handler && !config?.disabled) {
			return;
		}
		menu.addItem((item) => {
			item.setTitle(t(labelKey, config?.params));
			item.setIcon(icon);
			if (config?.danger) {
				const dom = (item as unknown as { dom?: HTMLElement }).dom;
				dom?.classList.add('tlb-menu-item-danger');
			}
			if (config?.disabled) {
				item.setDisabled(true);
				return;
			}
			if (handler) {
				item.onClick(withClose(handler, options.actions.close));
			}
		});
	};

	const addSeparator = () => {
		menu.addSeparator();
	};

	if (!options.isIndexColumn && options.cellMenu) {
		if (options.cellMenu.copy) {
			addItem('gridInteraction.menuCopyCell', 'copy', options.cellMenu.copy);
		}
		if (options.cellMenu.paste || options.cellMenu.disablePaste) {
			const disablePaste = options.cellMenu.disablePaste ?? false;
			addItem(
				'gridInteraction.menuPasteCell',
				'clipboard',
				options.cellMenu.paste,
				{ disabled: disablePaste || !options.cellMenu.paste }
			);
		}
		addSeparator();
	}

	if (options.undoRedo) {
		addItem(
			'gridInteraction.menuUndo',
			'rotate-ccw',
			options.undoRedo.canUndo ? options.undoRedo.onUndo : undefined,
			{ disabled: !options.undoRedo.canUndo }
		);
		addItem(
			'gridInteraction.menuRedo',
			'rotate-cw',
			options.undoRedo.canRedo ? options.undoRedo.onRedo : undefined,
			{ disabled: !options.undoRedo.canRedo }
		);
		addSeparator();
	}

	if (options.isIndexColumn) {
		if (options.actions.copySelection) {
			addItem('gridInteraction.menuCopySelection', 'copy', options.actions.copySelection, { disabled: options.selectedRowCount === 0 });
		}
		addItem('copyTemplate.menuCopy', 'clipboard', options.actions.copySelectionAsTemplate);
		addItem('copyTemplate.menuEdit', 'pencil', options.actions.editCopyTemplate);

		const migrateActions = options.actions.migrateSelection;
		if (migrateActions) {
			menu.addItem((item) => {
				item.setTitle(t('gridInteraction.menuMigrateSelection'));
				item.setIcon('corner-down-right');

				item.onClick((evt: MouseEvent) => {
					evt.preventDefault();
					evt.stopPropagation();
					const dom = (item as unknown as { dom?: HTMLElement }).dom;
					const rect = dom?.getBoundingClientRect();
					const ownerDoc = dom?.ownerDocument ?? document;
					const defaultView = ownerDoc.defaultView ?? window;
					const x = rect ? rect.right + 8 : evt.pageX ?? defaultView.innerWidth / 2;
					const y = rect ? rect.top : evt.pageY ?? defaultView.innerHeight / 2;

					if (activeSubmenu) {
						activeSubmenu.hide();
						activeSubmenu = null;
					}

					const submenu = new Menu();
					activeSubmenu = submenu;
					submenu.onHide(() => {
						if (activeSubmenu === submenu) {
							activeSubmenu = null;
						}
					});
					submenu.addItem((subItem) => {
						subItem.setTitle(t('gridInteraction.migrateMenuMoveToNew'));
						subItem.setIcon('arrow-right');
						subItem.onClick(withClose(migrateActions.moveToNew, options.actions.close));
					});
					submenu.addItem((subItem) => {
						subItem.setTitle(t('gridInteraction.migrateMenuCopyToNew'));
						subItem.setIcon('copy');
						subItem.onClick(withClose(migrateActions.copyToNew, options.actions.close));
					});
					submenu.addItem((subItem) => {
						subItem.setTitle(t('gridInteraction.migrateMenuMoveToExisting'));
						subItem.setIcon('corner-down-right');
						subItem.onClick(withClose(migrateActions.moveToExisting, options.actions.close));
					});

					submenu.showAtPosition({ x, y }, ownerDoc);
				});
			});
		}

		if (options.actions.promoteToNote) {
			const params =
				typeof options.promotionCount === 'number' && options.promotionCount > 1
					? { count: String(options.promotionCount) }
					: undefined;
			addItem('paragraphPromotion.menuLabel', 'file-plus', options.actions.promoteToNote, { params });
		}

		addSeparator();
	}

	addItem('gridInteraction.insertRowAbove', 'arrow-up', options.actions.insertAbove);
	addItem('gridInteraction.insertRowBelow', 'arrow-down', options.actions.insertBelow);

	addSeparator();

	if (options.isMultiSelect) {
		if (options.actions.fillSelectionWithValue && options.fillSelectionLabelParams) {
			addItem(
				'gridInteraction.fillSelectedColumn',
				'repeat',
				options.actions.fillSelectionWithValue,
				{ params: options.fillSelectionLabelParams }
			);
		}
		const params = { count: String(options.selectedRowCount) };
		addItem('gridInteraction.duplicateSelected', 'copy', options.actions.duplicateSelection, { params });
		addItem('gridInteraction.deleteSelected', 'trash', options.actions.deleteSelection, { params, danger: true });
	} else {
		addItem('gridInteraction.duplicateRow', 'copy', options.actions.duplicateRow);
		addItem('gridInteraction.deleteRow', 'trash', options.actions.deleteRow, { danger: true });
	}

	menu.onHide(() => {
		if (activeSubmenu) {
			activeSubmenu.hide();
			activeSubmenu = null;
		}
	});

	return menu;
}


