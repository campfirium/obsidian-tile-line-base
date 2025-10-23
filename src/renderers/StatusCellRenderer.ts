/**
 * StatusCellRenderer - 状态列自定义渲染器
 *
 * 功能：
 * - 渲染 5 种任务状态图标（todo, done, inprogress, onhold, canceled）
 * - 左键点击：在 todo ↔ done 之间切换
 * - 右键点击：显示所有 5 种状态的菜单
 * - 支持可访问性（title, aria-label）
 */

import { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';
import { setIcon } from 'obsidian';
import { t, type TranslationKey } from '../i18n';

// 状态类型定义
export type TaskStatus = 'todo' | 'done' | 'inprogress' | 'onhold' | 'canceled';

/**
 * 状态规范化：将各种别名统一为标准状态值
 */
export function normalizeStatus(value: any): TaskStatus {
	const str = String(value || 'todo').toLowerCase().trim();

	// done 的别名
	if (str === 'done' || str === 'completed') {
		return 'done';
	}

	// inprogress 的别名
	if (str === 'inprogress' || str === 'in-progress' || str === 'in_progress' || str === 'doing') {
		return 'inprogress';
	}

	// onhold 的别名
	if (str === 'onhold' || str === 'on-hold' || str === 'on_hold' || str === 'hold' || str === 'paused') {
		return 'onhold';
	}

	// canceled 的别名
	if (str === 'canceled' || str === 'cancelled' || str === 'dropped') {
		return 'canceled';
	}

	// 默认为 todo
	return 'todo';
}

/**
 * 获取状态对应的 Lucide 图标 ID
 */
export function getStatusIcon(status: TaskStatus): string {
	const icons: Record<TaskStatus, string> = {
		'todo': 'square',           // □ 空方框（Obsidian 任务列表原生）
		'done': 'check-square',     // ☑ 已完成（Obsidian 任务列表原生）
		'inprogress': 'circle-dashed',  // ◌ 虚线圆（暗示进行中）
		'onhold': 'pause-circle',   // ⏸ 暂停图标
		'canceled': 'x-square'      // ☒ 叉号方框
	};
	return icons[status] || icons['todo'];
}

/**
 * 获取状态对应的文字标签（用于可访问性和导出）
 */
const STATUS_LABEL_KEYS: Record<TaskStatus, TranslationKey> = {
	todo: 'statusCell.labels.todo',
	done: 'statusCell.labels.done',
	inprogress: 'statusCell.labels.inprogress',
	onhold: 'statusCell.labels.onhold',
	canceled: 'statusCell.labels.canceled'
};

export function getStatusLabel(status: TaskStatus): string {
	const key = STATUS_LABEL_KEYS[status] ?? STATUS_LABEL_KEYS.todo;
	return t(key);
}

/**
 * StatusCellRenderer - AG Grid 自定义单元格渲染器
 */
export class StatusCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private params!: ICellRendererParams;
	private clickHandler?: (e: MouseEvent) => void;
	private contextMenuHandler?: (e: MouseEvent) => void;
	private keydownHandler?: (e: KeyboardEvent) => void;
	private contextMenu: HTMLElement | null = null;
	private documentClickHandler?: (e: MouseEvent) => void;
	private menuKeydownHandler?: (e: KeyboardEvent) => void;
	private contextMenuItems: Array<{ element: HTMLElement; status: TaskStatus; disabled: boolean }> = [];
	private focusedMenuIndex = -1;
	private shouldRestoreFocusToCell = false;

	/**
	 * 初始化渲染器
	 */
	init(params: ICellRendererParams): void {
		this.params = params;

		// 从 AG Grid 的单元格元素获取正确的 document（支持 pop-out 窗口）
		const doc = (params.eGridCell?.ownerDocument || document);

		// 创建容器元素
		this.eGui = doc.createElement('div');
		this.eGui.className = 'tlb-status-cell';
		this.eGui.style.display = 'flex';
		this.eGui.style.alignItems = 'center';
		this.eGui.style.justifyContent = 'center';
		this.eGui.style.cursor = 'pointer';
		this.eGui.style.userSelect = 'none';  // 禁止文本选择
		this.eGui.style.width = '100%';
		this.eGui.style.height = '100%';
		this.eGui.tabIndex = 0;
		this.eGui.setAttribute('role', 'button');
		this.eGui.setAttribute('aria-haspopup', 'menu');
		this.eGui.setAttribute('aria-keyshortcuts', 'Space Enter Shift+F10');
		this.eGui.setAttribute('data-tlb-status-cell', 'true');

		// 渲染图标
		this.renderIcon();

		// 绑定左键点击事件（切换状态）
		this.clickHandler = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			this.hideContextMenu();  // 隐藏可能存在的菜单
			this.handleClick();
		};

		// 绑定右键菜单事件（显示所有状态选项）
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
			if (key === ' ' || key === 'Space' || key === 'Spacebar' || key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				this.hideContextMenu();
				this.handleClick();
				return;
			}

			const isContextMenuKey = key === 'ContextMenu' || key === 'Apps';
			if ((key === 'F10' && event.shiftKey) || isContextMenuKey) {
				event.preventDefault();
				event.stopPropagation();
				const rect = this.eGui.getBoundingClientRect();
				// 取单元格中心作为菜单定位点，避免遮挡
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
	 * 渲染图标和可访问性属性
	 */
	private renderIcon(): void {
		const status = normalizeStatus(this.params.data?.status);
		const iconId = getStatusIcon(status);
		const label = getStatusLabel(status);

		// 清空内容，使用 Obsidian 的 Lucide 图标
		this.eGui.innerHTML = '';
		setIcon(this.eGui, iconId);

		// 添加可访问性支持
		this.eGui.title = label;
		this.eGui.setAttribute('aria-label', label);
		this.eGui.setAttribute('aria-expanded', this.contextMenu ? 'true' : 'false');
	}

	/**
	 * 处理左键点击：切换状态
	 */
	private handleClick(): void {
		// 获取当前状态
		const currentStatus = normalizeStatus(this.params.data?.status);

		// 计算新状态（todo ↔ done，其他状态统一变为 done）
		let newStatus: TaskStatus;
		if (currentStatus === 'todo') {
			newStatus = 'done';
		} else if (currentStatus === 'done') {
			newStatus = 'todo';
		} else {
			// inprogress, onhold, canceled 点击后统一变为 done
			newStatus = 'done';
		}

		this.changeStatus(newStatus);
	}

	/**
	 * 显示右键菜单
	 */
	private showContextMenu(options?: { clientX?: number; clientY?: number; triggeredByKeyboard?: boolean }): void {
		// 隐藏旧菜单
		this.hideContextMenu();

		const currentStatus = normalizeStatus(this.params.data?.status);

		// 获取容器所在的 document（支持新窗口）
		const ownerDoc = this.eGui.ownerDocument;
		this.contextMenu = ownerDoc.createElement('div');
		const menu = this.contextMenu;
		menu.className = 'tlb-status-context-menu';
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', t('statusCell.menuLabel'));
		menu.style.position = 'fixed';
		menu.style.zIndex = '10000';
		menu.style.backgroundColor = 'var(--background-primary)';
		menu.style.border = '1px solid var(--background-modifier-border)';
		menu.style.borderRadius = '4px';
		menu.style.padding = '4px 0';
		menu.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
		menu.style.minWidth = '120px';

		// 创建菜单项
		const statuses: TaskStatus[] = ['todo', 'done', 'inprogress', 'onhold', 'canceled'];

		this.contextMenuItems = [];
		this.focusedMenuIndex = -1;
		for (const status of statuses) {
			const label = getStatusLabel(status);
			const item = ownerDoc.createElement('div');
			item.className = 'tlb-status-menu-item';
			item.style.padding = '6px 12px';
			item.style.cursor = 'pointer';
			item.style.userSelect = 'none';
			item.style.display = 'flex';
			item.style.alignItems = 'center';
			item.style.gap = '8px';
			item.setAttribute('role', 'menuitemradio');
			item.setAttribute('aria-label', label);
			item.setAttribute('tabindex', '-1');

			// 创建图标容器
			const iconContainer = ownerDoc.createElement('span');
			iconContainer.style.display = 'inline-flex';
			iconContainer.style.width = '16px';
			iconContainer.style.height = '16px';
			setIcon(iconContainer, getStatusIcon(status));

			// 创建文本标签
			const labelSpan = ownerDoc.createElement('span');
			labelSpan.textContent = label;

			// 组装菜单项
			item.appendChild(iconContainer);
			item.appendChild(labelSpan);

			// 当前状态禁用
			if (status === currentStatus) {
				item.style.opacity = '0.5';
				item.style.cursor = 'default';
				item.setAttribute('aria-checked', 'true');
				item.setAttribute('aria-disabled', 'true');
				this.contextMenuItems.push({ element: item, status, disabled: true });
			} else {
				item.setAttribute('aria-checked', 'false');
				// 悬停效果
				item.addEventListener('mouseenter', () => {
					item.style.backgroundColor = 'var(--background-modifier-hover)';
				});
				item.addEventListener('mouseleave', () => {
					item.style.backgroundColor = '';
				});

				// 点击切换状态
				item.addEventListener('click', (e) => {
					e.stopPropagation();
					this.changeStatus(status);
					this.hideContextMenu();
				});
				this.contextMenuItems.push({ element: item, status, disabled: false });
			}

			menu.appendChild(item);
		}

		// 定位菜单
		const defaultView = ownerDoc.defaultView || window;
		const viewportWidth = defaultView.innerWidth;
		const viewportHeight = defaultView.innerHeight;

		// 临时添加到 DOM 以获取尺寸
		ownerDoc.body.appendChild(menu);
		const menuRect = menu.getBoundingClientRect();

		const fallbackRect = this.eGui.getBoundingClientRect();
		let left = options?.clientX ?? (fallbackRect.left + fallbackRect.width / 2);
		let top = options?.clientY ?? (fallbackRect.top + fallbackRect.height);

		// 防止超出屏幕
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

		// 点击外部隐藏菜单
		this.documentClickHandler = (e: MouseEvent) => {
			// 如果点击在菜单内部，不隐藏
			if (this.contextMenu && this.contextMenu.contains(e.target as Node)) {
				return;
			}
			// 点击外部或右键，隐藏菜单
			this.hideContextMenu();
		};

		// 延迟添加监听器，避免当前右键事件立即触发
		setTimeout(() => {
			if (this.documentClickHandler) {
				ownerDoc.addEventListener('click', this.documentClickHandler, { capture: true });
				ownerDoc.addEventListener('contextmenu', this.documentClickHandler, { capture: true });
			}
		}, 0);
	}

	/**
	 * 隐藏右键菜单
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

		// 移除 document 的点击监听器
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
	 * 更改状态（通用方法）
	 */
	private changeStatus(newStatus: TaskStatus): void {
		// 获取 rowId（稳定标识，不受排序/过滤影响）
		const rowId = this.params.node?.id;
		if (!rowId) {
			console.error('StatusCellRenderer: rowId is undefined');
			return;
		}

		// 通过回调通知 TableView 进行状态变更
		if (this.params.context?.onStatusChange) {
			this.params.context.onStatusChange(rowId, newStatus);
		} else {
			console.warn('StatusCellRenderer: onStatusChange callback not found in context');
		}
	}

	/**
	 * 返回 DOM 元素
	 */
	getGui(): HTMLElement {
		return this.eGui;
	}

	/**
	 * 刷新渲染器（支持增量更新）
	 * 返回 true 表示复用当前实例，返回 false 表示重新创建实例
	 */
	refresh(params: ICellRendererParams): boolean {
		this.params = params;
		this.renderIcon();
		return true;  // 复用实例，避免重新创建
	}

	/**
	 * 销毁渲染器（清理事件监听器）
	 */
	destroy(): void {
		this.shouldRestoreFocusToCell = false;
		this.hideContextMenu();

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
	}
}
