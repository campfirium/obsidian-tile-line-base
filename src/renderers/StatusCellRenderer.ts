import { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';
import {
	STATUS_ICON_MAP,
	STATUS_LABEL_MAP,
	StatusValue,
	normalizeStatus
} from '../status/statusUtils';

export class StatusCellRenderer implements ICellRendererComp {
	private eGui: HTMLDivElement;
	private status: StatusValue = 'todo';

	init(params: ICellRendererParams): void {
		this.eGui = document.createElement('div');
		this.eGui.className = 'tlb-status-cell-renderer';
		this.eGui.tabIndex = -1;
		this.update(params.value);
	}

	getGui(): HTMLElement {
		return this.eGui;
	}

	refresh(params: ICellRendererParams): boolean {
		this.update(params.value);
		return true;
	}

	destroy(): void {
		// nothing to cleanup
	}

	private update(rawValue: unknown): void {
		this.status = normalizeStatus(rawValue);
		const icon = STATUS_ICON_MAP[this.status];
		const label = STATUS_LABEL_MAP[this.status];

		this.eGui.textContent = '';
		this.eGui.dataset.icon = icon;
		this.eGui.title = label;
		this.eGui.dataset.status = this.status;
		this.eGui.setAttribute('aria-label', label);
		this.eGui.setAttribute('role', 'checkbox');
		const ariaChecked = this.status === 'done' ? 'true' : (this.status === 'todo' ? 'false' : 'mixed');
		this.eGui.setAttribute('aria-checked', ariaChecked);
	}
}
