/**
 * IconHeaderComponent - 自定义标题组件，显示图标而非文字
 *
 * 用于 # 列和 status 列的标题，显示图标替代文本标签
 */

import { IHeaderComp, IHeaderParams } from 'ag-grid-community';
import { setIcon } from 'obsidian';

export interface IconHeaderParams extends IHeaderParams {
	icon: string;
	fallbacks?: string[];
	tooltip?: string;
}

export class IconHeaderComponent implements IHeaderComp {
	private eGui!: HTMLDivElement;
	private iconEl!: HTMLDivElement;
	private params!: IconHeaderParams;

	init(params: IconHeaderParams): void {
		this.params = params;

		// 创建容器
		this.eGui = document.createElement('div');
		this.eGui.className = 'ag-cell-label-container';
		this.eGui.setAttribute('role', 'presentation');

		// 创建图标容器
		this.iconEl = document.createElement('div');
		this.iconEl.className = 'tlb-header-icon';
		this.iconEl.setAttribute('aria-hidden', 'true');
		this.iconEl.setAttribute('role', 'presentation');

		// 设置图标
		setIcon(this.iconEl, params.icon);

		// 尝试 fallback 图标
		if (!this.iconEl.querySelector('svg') && params.fallbacks) {
			for (const fallback of params.fallbacks) {
				setIcon(this.iconEl, fallback);
				if (this.iconEl.querySelector('svg')) {
					break;
				}
			}
		}

		// 设置 tooltip
		if (params.tooltip) {
			this.eGui.setAttribute('title', params.tooltip);
			this.iconEl.setAttribute('aria-label', params.tooltip);
		}

		this.eGui.appendChild(this.iconEl);
	}

	getGui(): HTMLElement {
		return this.eGui;
	}

	refresh(_params: IconHeaderParams): boolean {
		// 不需要刷新，返回 false 让 AG Grid 重新创建
		return false;
	}

	destroy(): void {
		// 清理资源
	}
}
