/**
 * StatusCellRenderer - 状态列单元格渲染器
 *
 * 渲染任务状态勾选框，支持两种状态：
 * - 未勾选：空方框
 * - 已勾选：带勾的方框
 *
 * 注意：点击事件由 AgGridAdapter 的 onCellClicked 统一处理
 */

import { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';

export class StatusCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private checkbox!: HTMLElement;

	/**
	 * 初始化渲染器
	 */
	init(params: ICellRendererParams): void {
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

		// 创建勾选框
		this.checkbox = document.createElement('div');
		this.checkbox.className = 'tlb-checkbox';
		this.checkbox.style.cssText = `
			width: 16px;
			height: 16px;
			border: 2px solid var(--checkbox-border);
			border-radius: 3px;
			background: var(--checkbox-color);
			display: flex;
			align-items: center;
			justify-content: center;
			transition: all 0.1s ease-in-out;
			flex-shrink: 0;
		`;

		this.eGui.appendChild(this.checkbox);

		// 渲染状态图标
		this.refresh(params);

		// 添加悬停效果
		this.eGui.addEventListener('mouseenter', () => {
			this.checkbox.style.borderColor = 'var(--checkbox-border-hover)';
		});

		this.eGui.addEventListener('mouseleave', () => {
			this.checkbox.style.borderColor = 'var(--checkbox-border)';
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
		// 获取当前状态值
		const value = params.value;
		const isDone = value === 'done' || value === '☑' || value === true;

		// 清空勾选框内容
		this.checkbox.innerHTML = '';

		if (isDone) {
			// 已完成：显示勾号
			const checkmark = document.createElement('svg');
			checkmark.setAttribute('viewBox', '0 0 14 14');
			checkmark.style.cssText = `
				width: 12px;
				height: 12px;
				fill: none;
				stroke: var(--text-on-accent);
				stroke-width: 2;
				stroke-linecap: round;
				stroke-linejoin: round;
			`;
			checkmark.innerHTML = '<polyline points="2,7 6,11 12,3"></polyline>';

			this.checkbox.style.background = 'var(--interactive-accent)';
			this.checkbox.style.borderColor = 'var(--interactive-accent)';
			this.checkbox.appendChild(checkmark);
		} else {
			// 未完成：空方框
			this.checkbox.style.background = 'var(--checkbox-color)';
			this.checkbox.style.borderColor = 'var(--checkbox-border)';
		}

		return true;
	}

	/**
	 * 销毁渲染器
	 */
	destroy(): void {
		// 清理资源
	}
}
