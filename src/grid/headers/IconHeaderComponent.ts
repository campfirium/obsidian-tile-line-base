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
		const doc = params.eGridHeader?.ownerDocument || document;

		this.eGui = doc.createElement('div');
		this.eGui.classList.add('ag-header-cell-label', 'tlb-header-icon-only');
		this.eGui.setAttribute('role', 'presentation');

		this.iconEl = doc.createElement('div');
		this.iconEl.className = 'tlb-header-icon';
		this.iconEl.setAttribute('aria-hidden', 'true');

		setIcon(this.iconEl, params.icon);

		if (!this.iconEl.querySelector('svg') && params.fallbacks) {
			for (const fallback of params.fallbacks) {
				setIcon(this.iconEl, fallback);
				if (this.iconEl.querySelector('svg')) {
					break;
				}
			}
		}

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
		return false;
	}

	destroy(): void {
		if (this.iconEl) {
			this.iconEl.replaceChildren();
		}
	}
}

