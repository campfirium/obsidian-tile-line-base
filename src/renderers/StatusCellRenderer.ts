/**
 * StatusCellRenderer - 状态列自定义渲染器
 *
 * 功能：
 * - 渲染 5 种任务状态图标（todo, done, inprogress, onhold, canceled）
 * - 左键点击：在 todo ↔ done 之间切换
 * - 支持可访问性（title, aria-label）
 */

import { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';
import { ROW_ID_FIELD } from '../grid/GridAdapter';

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
 * 获取状态对应的 Unicode 图标
 */
export function getStatusIcon(status: TaskStatus): string {
	const icons: Record<TaskStatus, string> = {
		'todo': '☐',        // U+2610 空方框
		'done': '☑',        // U+2611 方框中对勾
		'inprogress': '⊟',  // U+229F 方框中横线
		'onhold': '⏸',      // U+23F8 暂停符号
		'canceled': '☒'     // U+2612 方框中叉号
	};
	return icons[status] || icons['todo'];
}

/**
 * 获取状态对应的文字标签（用于可访问性和导出）
 */
export function getStatusLabel(status: TaskStatus): string {
	const labels: Record<TaskStatus, string> = {
		'todo': '待办',
		'done': '已完成',
		'inprogress': '进行中',
		'onhold': '已搁置',
		'canceled': '已放弃'
	};
	return labels[status] || labels['todo'];
}

/**
 * StatusCellRenderer - AG Grid 自定义单元格渲染器
 */
export class StatusCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private params!: ICellRendererParams;
	private clickHandler?: (e: MouseEvent) => void;

	/**
	 * 初始化渲染器
	 */
	init(params: ICellRendererParams): void {
		this.params = params;

		// 创建容器元素
		this.eGui = document.createElement('div');
		this.eGui.className = 'tlb-status-cell';
		this.eGui.style.textAlign = 'center';
		this.eGui.style.cursor = 'pointer';
		this.eGui.style.fontSize = '16px';
		this.eGui.style.userSelect = 'none';  // 禁止文本选择

		// 渲染图标
		this.renderIcon();

		// 绑定点击事件（左键切换状态）
		this.clickHandler = (e: MouseEvent) => {
			// 阻止所有事件传播，防止 AG Grid 捕获
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();

			this.handleClick();
		};

		this.eGui.addEventListener('click', this.clickHandler);
	}

	/**
	 * 渲染图标和可访问性属性
	 */
	private renderIcon(): void {
		const status = normalizeStatus(this.params.data?.status);
		const icon = getStatusIcon(status);
		const label = getStatusLabel(status);

		// 设置图标
		this.eGui.textContent = icon;

		// 添加可访问性支持
		this.eGui.title = label;
		this.eGui.setAttribute('aria-label', label);
		this.eGui.setAttribute('role', 'button');
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
		if (this.clickHandler && this.eGui) {
			this.eGui.removeEventListener('click', this.clickHandler);
			this.clickHandler = undefined;
		}
	}
}
