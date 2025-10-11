/**
 * StatusCellRenderer - 状态列单元格渲染器
 *
 * 渲染任务状态勾选框，支持两种状态：
 * - 未勾选：☐
 * - 已勾选：☑
 */

import { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';

export class StatusCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private params!: ICellRendererParams;

	/**
	 * 初始化渲染器
	 */
	init(params: ICellRendererParams): void {
		this.params = params;

		// 创建容器
		this.eGui = document.createElement('div');
		this.eGui.className = 'tlb-status-cell';
		this.eGui.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100%;
			cursor: pointer;
			user-select: none;
		`;

		// 渲染状态图标
		this.refresh(params);

		// 添加点击事件
		this.eGui.addEventListener('click', () => {
			this.toggleStatus();
		});
	}

	/**
	 * 获取渲染的 DOM 元素
	 */
	getGui(): HTMLElement {
		return this.eGui;
	}

	/**
	 * 刷新渲染内容
	 */
	refresh(params: ICellRendererParams): boolean {
		this.params = params;

		// 获取当前状态值
		const value = params.value;
		const isDone = value === 'done' || value === '☑' || value === true;

		// 渲染图标
		const icon = document.createElement('span');
		icon.style.cssText = `
			font-size: 18px;
			line-height: 1;
		`;
		icon.textContent = isDone ? '☑' : '☐';

		// 清空并添加新内容
		this.eGui.innerHTML = '';
		this.eGui.appendChild(icon);

		return true;
	}

	/**
	 * 切换状态
	 */
	private toggleStatus(): void {
		if (!this.params || !this.params.node || !this.params.colDef) {
			return;
		}

		const field = this.params.colDef.field;
		if (!field) {
			return;
		}

		// 获取当前值
		const currentValue = this.params.value;
		const isDone = currentValue === 'done' || currentValue === '☑' || currentValue === true;

		// 切换状态
		const newValue = isDone ? 'todo' : 'done';

		// 更新数据
		this.params.node.setDataValue(field, newValue);
	}

	/**
	 * 销毁渲染器
	 */
	destroy(): void {
		// 清理资源
	}
}
