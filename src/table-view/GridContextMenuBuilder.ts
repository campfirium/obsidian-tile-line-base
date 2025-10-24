import { t } from '../i18n';

interface MenuBuilderOptions {
	ownerDoc: Document;
	isIndexColumn: boolean;
	isMultiSelect: boolean;
	selectedRowCount: number;
	actions: {
		copySection: () => void;
		editCopyTemplate: () => void;
		insertAbove: () => void;
		insertBelow: () => void;
		duplicateSelection: () => void;
		deleteSelection: () => void;
		duplicateRow: () => void;
		deleteRow: () => void;
		close: () => void;
	};
}

export function buildGridContextMenu(options: MenuBuilderOptions): HTMLElement {
	const menu = options.ownerDoc.body.createDiv({ cls: 'tlb-context-menu' });
	menu.style.visibility = 'hidden';
	menu.style.left = '0px';
	menu.style.top = '0px';

	const addItem = (
		labelKey: Parameters<typeof t>[0],
		handler: () => void,
		config?: { danger?: boolean; params?: Record<string, string> }
	): void => {
		const classes = ['tlb-context-menu-item'];
		if (config?.danger) {
			classes.push('tlb-context-menu-item-danger');
		}
		const item = menu.createDiv({ cls: classes.join(' ') });
		item.createSpan({ text: t(labelKey, config?.params) });
		item.addEventListener('click', () => {
			handler();
			options.actions.close();
		});
	};

	const addSeparator = () => {
		menu.createDiv({ cls: 'tlb-context-menu-separator' });
	};

	if (options.isIndexColumn) {
		addItem('copyTemplate.menuCopy', options.actions.copySection);
		addItem('copyTemplate.menuEdit', options.actions.editCopyTemplate);
		addSeparator();
	}

	addItem('gridInteraction.insertRowAbove', options.actions.insertAbove);
	addItem('gridInteraction.insertRowBelow', options.actions.insertBelow);

	addSeparator();

	if (options.isMultiSelect) {
		const params = { count: String(options.selectedRowCount) };
		addItem('gridInteraction.duplicateSelected', options.actions.duplicateSelection, { params });
		addItem('gridInteraction.deleteSelected', options.actions.deleteSelection, { params, danger: true });
	} else {
		addItem('gridInteraction.duplicateRow', options.actions.duplicateRow);
		addItem('gridInteraction.deleteRow', options.actions.deleteRow, { danger: true });
	}

	return menu;
}
