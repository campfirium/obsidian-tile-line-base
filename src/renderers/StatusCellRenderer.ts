/**
 * StatusCellRenderer - ״̬���Զ�����Ⱦ��
 *
 * ���ܣ�
 * - ��Ⱦ 6 ������״̬ͼ�꣨todo, done, inprogress, onhold, someday, canceled��
 * - ���������� todo ? done ֮���л�
 * - �Ҽ��������ʾȫ��״̬�Ĳ˵�?
 * - ֧�ֿɷ����ԣ�title, aria-label��
 */

import { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';
import { setIcon } from 'obsidian';
import { t, type TranslationKey } from '../i18n';
import { getLogger } from '../utils/logger';

const logger = getLogger('renderer:status-cell');

// ״̬���Ͷ���
export type TaskStatus = 'todo' | 'done' | 'inprogress' | 'onhold' | 'someday' | 'canceled';
export const ALL_TASK_STATUSES: readonly TaskStatus[] = ['todo', 'done', 'inprogress', 'onhold', 'someday', 'canceled'] as const;

/**
 * ״̬�淶���������ֱ���ͳһΪ��׼״ֵ̬
 */
export function normalizeStatus(value: any): TaskStatus {
	const str = String(value || 'todo').toLowerCase().trim();
	const normalized = str.replace(/[\s_/-]+/g, '');

	// done �ı���
	if (normalized === 'done' || normalized === 'completed') {
		return 'done';
	}

	// inprogress �ı���
	if (normalized === 'inprogress' || normalized === 'doing') {
		return 'inprogress';
	}

	// onhold �ı���
	if (normalized === 'onhold' || normalized === 'hold' || normalized === 'paused') {
		return 'onhold';
	}

	// someday 的别�?
	if (
		normalized === 'someday' ||
		normalized === 'later' ||
		normalized === 'maybe' ||
		normalized === 'somedaymaybe'
	) {
		return 'someday';
	}

	// canceled �ı���
	if (normalized === 'canceled' || normalized === 'cancelled' || normalized === 'dropped') {
		return 'canceled';
	}

	// Ĭ��Ϊ todo
	return 'todo';
}

/**
 * ��ȡ״̬��Ӧ�� Lucide ͼ�� ID
 */
export function getStatusIcon(status: TaskStatus): string {
	const icons: Record<TaskStatus, string> = {
		'todo': 'square',           // �� �շ���Obsidian �����б�ԭ����
		'done': 'check-square',     // ? ����ɣ�Obsidian �����б�ԭ����
		'inprogress': 'loader-circle',  // Use spinning loader to indicate work in progress
		'onhold': 'pause-circle',   // ? ��ͣͼ��
		'someday': 'circle-dashed',   // Use dashed circle to express deferred/undecided status
		'canceled': 'x-square'      // ? ��ŷ���?
	};
	return icons[status] || icons['todo'];
}

/**
 * ��ȡ״̬��Ӧ�����ֱ�ǩ�����ڿɷ����Ժ͵�����
 */
const STATUS_LABEL_KEYS: Record<TaskStatus, TranslationKey> = {
	todo: 'statusCell.labels.todo',
	done: 'statusCell.labels.done',
	inprogress: 'statusCell.labels.inprogress',
	onhold: 'statusCell.labels.onhold',
	someday: 'statusCell.labels.someday',
	canceled: 'statusCell.labels.canceled'
};

export function getStatusLabel(status: TaskStatus): string {
	const key = STATUS_LABEL_KEYS[status] ?? STATUS_LABEL_KEYS.todo;
	return t(key);
}

const STATUS_MENU_STATUSES: TaskStatus[] = ['todo', 'done', 'inprogress', 'onhold', 'someday', 'canceled'];

/**
 * StatusCellRenderer - AG Grid �Զ��嵥Ԫ����Ⱦ��
 */
export class StatusCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private params!: ICellRendererParams;
	private hostCell: HTMLElement | null = null;
	private clickHandler?: (e: MouseEvent) => void;
	private contextMenuHandler?: (e: MouseEvent) => void;
	private keydownHandler?: (e: KeyboardEvent) => void;
	private contextMenu: HTMLElement | null = null;
	private documentClickHandler?: (e: MouseEvent) => void;
	private menuKeydownHandler?: (e: KeyboardEvent) => void;
	private contextMenuItems: Array<{ element: HTMLElement; status: TaskStatus; disabled: boolean }> = [];
	private focusedMenuIndex = -1;
	private shouldRestoreFocusToCell = false;
	private srLabelElement: HTMLElement | null = null;

	/**
	 * ��ʼ����Ⱦ��
	 */
	init(params: ICellRendererParams): void {
		this.params = params;

		// �� AG Grid �ĵ�Ԫ��Ԫ�ػ�ȡ��ȷ�� document��֧�� pop-out ���ڣ�
		const doc = (params.eGridCell?.ownerDocument || document);
		this.hostCell = params.eGridCell ?? null;
		if (this.hostCell) {
			this.hostCell.setAttribute('data-tlb-tooltip-disabled', 'true');
		}

		// ��������Ԫ��
		this.eGui = doc.createElement('div');
		this.eGui.className = 'tlb-status-cell';
		this.eGui.tabIndex = 0;
		this.eGui.setAttribute('role', 'button');
		this.eGui.setAttribute('aria-haspopup', 'menu');
		this.eGui.setAttribute('aria-keyshortcuts', 'Space Enter Shift+F10');
		this.eGui.setAttribute('data-tlb-status-cell', 'true');
		this.eGui.setAttribute('data-tlb-tooltip-disabled', 'true');

		// ��Ⱦͼ��
		this.renderIcon();

		// ���������¼����л�״̬��
		this.clickHandler = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			this.hideContextMenu();  // ���ؿ��ܴ��ڵĲ˵�
			this.handleClick();
		};

		// ���Ҽ��˵��¼�����ʾ����״̬ѡ�
		this.contextMenuHandler = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			this.showContextMenu({ clientX: e.clientX, clientY: e.clientY });
		};

		this.eGui.addEventListener('click', this.clickHandler);
		this.eGui.addEventListener('contextmenu', this.contextMenuHandler);

		this.keydownHandler = (event: KeyboardEvent) => {
			const key = event.key;
			if (key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				this.hideContextMenu();
				this.handleClick();
				return;
			}

			const isContextMenuKey = key === 'ContextMenu' || key === 'Apps';
			if ((key === 'F10' && event.shiftKey) || isContextMenuKey) {
				event.preventDefault();
				event.stopPropagation();
				const rect = this.eGui.getBoundingClientRect();
				const anchor = {
					clientX: rect.left + rect.width / 2,
					clientY: rect.top + rect.height / 2,
					triggeredByKeyboard: true
				};
				this.showContextMenu(anchor);
			}
		};
		this.eGui.addEventListener('keydown', this.keydownHandler);
	}

	/**
	 * ��Ⱦͼ��Ϳɷ���������?
	 */
	private renderIcon(): void {
		const status = normalizeStatus(this.params.data?.status);
		const iconId = getStatusIcon(status);
		const label = getStatusLabel(status);

		// ������ݣ�ʹ��?Obsidian �� Lucide ͼ��
		while (this.eGui.firstChild) {
			this.eGui.removeChild(this.eGui.firstChild);
		}
		setIcon(this.eGui, iconId);

		// ��ӿɷ�����֧��?
		if (this.srLabelElement && this.srLabelElement.isConnected) {
			this.srLabelElement.remove();
		}
		const doc = this.eGui.ownerDocument || document;
		const srLabel = doc.createElement('span');
		srLabel.textContent = label;
		srLabel.className = 'tlb-visually-hidden';
		const srId =
			this.params.node?.id != null
				? `tlb-status-sr-${this.params.node.id}`
				: `tlb-status-sr-${Date.now()}`;
		srLabel.id = srId;
		this.eGui.appendChild(srLabel);
		this.eGui.setAttribute('aria-labelledby', srId);
		this.srLabelElement = srLabel;
		this.eGui.setAttribute('aria-expanded', this.contextMenu ? 'true' : 'false');
	}

	/**
	 * �������������л�״̬
	 */
	private handleClick(): void {
		// ��ȡ��ǰ״̬
		const currentStatus = normalizeStatus(this.params.data?.status);

		// ������״̬��todo ? done������״̬ͳһ��Ϊ done��
		let newStatus: TaskStatus;
		if (currentStatus === 'todo') {
			newStatus = 'done';
		} else if (currentStatus === 'done') {
			newStatus = 'todo';
		} else {
			// inprogress, onhold, canceled �����ͳһ���?done
			newStatus = 'done';
		}

		this.changeStatus(newStatus);
	}

	/**
	 * ��ʾ�Ҽ��˵�
	 */
	private showContextMenu(options?: { clientX?: number; clientY?: number; triggeredByKeyboard?: boolean }): void {
		// ���ؾɲ˵�
		this.hideContextMenu();

		const currentStatus = normalizeStatus(this.params.data?.status);

		// ��ȡ�������ڵ� document��֧���´��ڣ�
		const ownerDoc = this.eGui.ownerDocument;
		this.contextMenu = ownerDoc.createElement('div');
		const menu = this.contextMenu;
		menu.className = 'tlb-status-context-menu';
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', t('statusCell.menuLabel'));

		// �����˵���
		this.contextMenuItems = [];
		this.focusedMenuIndex = -1;
		for (const status of STATUS_MENU_STATUSES) {
			const label = getStatusLabel(status);
			const item = ownerDoc.createElement('div');
			item.className = 'tlb-status-menu-item';
			item.setAttribute('role', 'menuitemradio');
			item.setAttribute('aria-label', label);
			item.setAttribute('tabindex', '-1');

			// ����ͼ������
			const iconContainer = ownerDoc.createElement('span');
			iconContainer.className = 'tlb-status-menu-item__icon';
			setIcon(iconContainer, getStatusIcon(status));

			// �����ı���ǩ
			const labelSpan = ownerDoc.createElement('span');
			labelSpan.className = 'tlb-status-menu-item__label';
			labelSpan.textContent = label;

			// ��װ�˵���
			item.appendChild(iconContainer);
			item.appendChild(labelSpan);

			// ��ǰ״̬����
			if (status === currentStatus) {
				item.classList.add('is-active', 'is-disabled');
				item.setAttribute('aria-checked', 'true');
				item.setAttribute('aria-disabled', 'true');
				this.contextMenuItems.push({ element: item, status, disabled: true });
			} else {
				item.setAttribute('aria-checked', 'false');

				item.addEventListener('click', (e) => {
					e.stopPropagation();
					this.changeStatus(status);
					this.hideContextMenu();
				});
				this.contextMenuItems.push({ element: item, status, disabled: false });
			}

			menu.appendChild(item);
		}

		// ��λ�˵�
		const defaultView = ownerDoc.defaultView || window;
		const viewportWidth = defaultView.innerWidth;
		const viewportHeight = defaultView.innerHeight;

		// ��ʱ��ӵ�?DOM �Ի�ȡ�ߴ�
		ownerDoc.body.appendChild(menu);
		const menuRect = menu.getBoundingClientRect();

		const fallbackRect = this.eGui.getBoundingClientRect();
		let left = options?.clientX ?? (fallbackRect.left + fallbackRect.width / 2);
		let top = options?.clientY ?? (fallbackRect.top + fallbackRect.height);

		// ��ֹ������Ļ
		if (left + menuRect.width > viewportWidth - 8) {
			left = viewportWidth - menuRect.width - 8;
		}
		if (top + menuRect.height > viewportHeight - 8) {
			top = viewportHeight - menuRect.height - 8;
		}
		if (left < 8) left = 8;
		if (top < 8) top = 8;

		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
		this.eGui.setAttribute('aria-expanded', 'true');

		this.shouldRestoreFocusToCell = options?.triggeredByKeyboard ?? true;

		this.menuKeydownHandler = (event: KeyboardEvent) => {
			if (this.contextMenuItems.length === 0) {
				return;
			}
			const key = event.key;
			if (key === 'ArrowDown' || key === 'Down') {
				event.preventDefault();
				const nextIndex = this.findNextEnabledIndex(this.focusedMenuIndex, 1);
				if (nextIndex !== -1) {
					this.focusMenuItem(nextIndex);
				}
				return;
			}
			if (key === 'ArrowUp' || key === 'Up') {
				event.preventDefault();
				const prevIndex = this.findNextEnabledIndex(this.focusedMenuIndex, -1);
				if (prevIndex !== -1) {
					this.focusMenuItem(prevIndex);
				}
				return;
			}
			if (key === 'Home') {
				event.preventDefault();
				const firstIndex = this.findNextEnabledIndex(-1, 1);
				if (firstIndex !== -1) {
					this.focusMenuItem(firstIndex);
				}
				return;
			}
			if (key === 'End') {
				event.preventDefault();
				const lastIndex = this.findNextEnabledIndex(this.contextMenuItems.length, -1);
				if (lastIndex !== -1) {
					this.focusMenuItem(lastIndex);
				}
				return;
			}
			if (key === 'Enter' || key === ' ' || key === 'Space' || key === 'Spacebar') {
				event.preventDefault();
				const current = this.contextMenuItems[this.focusedMenuIndex];
				if (current && !current.disabled) {
					this.changeStatus(current.status);
				}
				this.hideContextMenu();
				return;
			}
			if (key === 'Escape' || key === 'Esc') {
				event.preventDefault();
				this.hideContextMenu();
				return;
			}
			if (key === 'Tab') {
				this.hideContextMenu();
			}
		};
		menu.addEventListener('keydown', this.menuKeydownHandler, true);

		const focusIndex = this.findNextEnabledIndex(-1, 1);
		if (focusIndex !== -1) {
			this.focusMenuItem(focusIndex);
		}

		// ����ⲿ���ز˵�?
		this.documentClickHandler = (e: MouseEvent) => {
			// �������ڲ˵��ڲ���������
			if (this.contextMenu && this.contextMenu.contains(e.target as Node)) {
				return;
			}
			// ����ⲿ���Ҽ������ز˵�?
			this.hideContextMenu();
		};

		// �ӳ���Ӽ����������⵱ǰ�Ҽ��¼���������?
		setTimeout(() => {
			if (this.documentClickHandler) {
				ownerDoc.addEventListener('click', this.documentClickHandler, { capture: true });
				ownerDoc.addEventListener('contextmenu', this.documentClickHandler, { capture: true });
			}
		}, 0);
	}

	/**
	 * �����Ҽ��˵�
	 */
	private hideContextMenu(): void {
		if (this.contextMenu && this.menuKeydownHandler) {
			this.contextMenu.removeEventListener('keydown', this.menuKeydownHandler, true);
		}
		if (this.contextMenu) {
			this.contextMenu.remove();
			this.contextMenu = null;
		}
		this.contextMenuItems = [];
		this.focusedMenuIndex = -1;
		this.eGui?.setAttribute('aria-expanded', 'false');
		this.menuKeydownHandler = undefined;

		// �Ƴ� document �ĵ��������?
		if (this.documentClickHandler) {
			const ownerDoc = this.eGui?.ownerDocument || document;
			ownerDoc.removeEventListener('click', this.documentClickHandler);
			ownerDoc.removeEventListener('contextmenu', this.documentClickHandler);
			this.documentClickHandler = undefined;
		}

		if (this.shouldRestoreFocusToCell && this.eGui?.isConnected) {
			this.eGui.focus({ preventScroll: true });
		}
		this.shouldRestoreFocusToCell = false;
	}

	private focusMenuItem(index: number): void {
		if (index < 0 || index >= this.contextMenuItems.length) {
			return;
		}
		const item = this.contextMenuItems[index];
		if (item.disabled) {
			return;
		}
		this.contextMenuItems.forEach((entry, idx) => {
			if (idx === index) {
				entry.element.setAttribute('tabindex', '0');
				entry.element.classList.add('is-focused');
				entry.element.focus({ preventScroll: true });
			} else {
				entry.element.setAttribute('tabindex', '-1');
				entry.element.classList.remove('is-focused');
			}
		});
		this.focusedMenuIndex = index;
	}

	private findNextEnabledIndex(startIndex: number, direction: 1 | -1): number {
		const total = this.contextMenuItems.length;
		if (total === 0) {
			return -1;
		}
		let attempts = 0;
		let index = startIndex;
		while (attempts < total) {
			index += direction;
			if (index < 0) {
				index = total - 1;
			} else if (index >= total) {
				index = 0;
			}
			const candidate = this.contextMenuItems[index];
			if (candidate && !candidate.disabled) {
				return index;
			}
			attempts += 1;
		}
		return -1;
	}

	/**
	 * ����״̬��ͨ�÷�����
	 */
	private changeStatus(newStatus: TaskStatus): void {
		// ��ȡ rowId���ȶ���ʶ����������/����Ӱ�죩
		const rowId = this.params.node?.id;
		if (!rowId) {
			logger.error('rowId is undefined');
			return;
		}

		// ͨ���ص�֪ͨ TableView ����״̬���?
		if (this.params.context?.onStatusChange) {
			this.params.context.onStatusChange(rowId, newStatus);
		} else {
			logger.warn('onStatusChange callback not found in context');
		}
	}

	/**
	 * ���� DOM Ԫ��
	 */
	getGui(): HTMLElement {
		return this.eGui;
	}

	/**
	 * ˢ����Ⱦ����֧���������£�
	 * ���� true ��ʾ���õ�ǰʵ�������� false ��ʾ���´���ʵ��
	 */
	refresh(params: ICellRendererParams): boolean {
		this.params = params;
		this.renderIcon();
		return true;  // ����ʵ�����������´���
	}

	/**
	 * ������Ⱦ���������¼���������
	 */
	destroy(): void {
		this.shouldRestoreFocusToCell = false;
		this.hideContextMenu();

		if (this.hostCell) {
			if (this.hostCell.getAttribute('data-tlb-tooltip-disabled') === 'true') {
				this.hostCell.removeAttribute('data-tlb-tooltip-disabled');
			}
			this.hostCell = null;
		}

		if (this.clickHandler && this.eGui) {
			this.eGui.removeEventListener('click', this.clickHandler);
			this.clickHandler = undefined;
		}

		if (this.contextMenuHandler && this.eGui) {
			this.eGui.removeEventListener('contextmenu', this.contextMenuHandler);
			this.contextMenuHandler = undefined;
		}

		if (this.keydownHandler && this.eGui) {
			this.eGui.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = undefined;
		}

		if (this.srLabelElement && this.srLabelElement.isConnected) {
			this.srLabelElement.remove();
			this.srLabelElement = null;
		}

	}
}


