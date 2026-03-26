import type { ICellRendererComp, ICellRendererParams } from 'ag-grid-community';
import { setIcon } from 'obsidian';
import { ROW_ID_FIELD, type RowData } from '../grid/GridAdapter';
import { ROW_COLLAPSED_FIELD, ROW_HAS_CHILDREN_FIELD, ROW_LEVEL_FIELD } from '../table-view/DisplayListBuilder';
import type { GridInteractionContext } from '../grid/interactions/types';
import type { DetectedCellLink } from '../types/cellLinks';
import { t } from '../i18n';
import { formatUnknownValue } from '../utils/valueFormat';
import { parseCellLinkSegments } from '../utils/linkDetection';

export class TreeTitleCellRenderer implements ICellRendererComp {
	private eGui!: HTMLElement;
	private toggleEl!: HTMLElement;
	private toggleIconEl!: HTMLElement;
	private spacerEl!: HTMLElement;
	private textEl!: HTMLElement;
	private params!: ICellRendererParams<RowData>;
	private currentLinks: DetectedCellLink[] = [];
	private toggleClickHandler?: (event: MouseEvent) => void;
	private toggleMouseDownHandler?: (event: MouseEvent) => void;
	private toggleKeydownHandler?: (event: KeyboardEvent) => void;
	private textClickHandler?: (event: MouseEvent) => void;
	private textMouseDownHandler?: (event: MouseEvent) => void;
	private textKeydownHandler?: (event: KeyboardEvent) => void;

	init(params: ICellRendererParams<RowData>): void {
		this.params = params;
		const doc = params.eGridCell?.ownerDocument ?? document;

		this.eGui = doc.createElement('div');
		this.eGui.className = 'tlb-tree-title-cell';

		this.toggleEl = doc.createElement('span');
		this.toggleEl.className = 'tlb-tree-title-cell__toggle';
		this.toggleEl.setAttribute('aria-hidden', 'true');
		this.toggleIconEl = doc.createElement('span');
		this.toggleIconEl.className = 'tlb-tree-title-cell__toggle-icon';
		this.toggleEl.appendChild(this.toggleIconEl);

		this.spacerEl = doc.createElement('span');
		this.spacerEl.className = 'tlb-tree-title-cell__spacer';
		this.spacerEl.setAttribute('aria-hidden', 'true');

		this.textEl = doc.createElement('span');
		this.textEl.className = 'tlb-tree-title-cell__text';

		this.eGui.append(this.toggleEl, this.spacerEl, this.textEl);
		this.attachToggleEvents();
		this.attachTextEvents();
		this.renderContent();
	}

	getGui(): HTMLElement {
		return this.eGui;
	}

	refresh(params: ICellRendererParams<RowData>): boolean {
		this.params = params;
		this.renderContent();
		return true;
	}

	destroy(): void {
		this.detachToggleEvents();
		this.detachTextEvents();
		this.currentLinks = [];
	}

	public shouldDisplayTooltip(): boolean {
		if (!this.textEl) {
			return false;
		}
		return this.textEl.scrollWidth > this.textEl.clientWidth + 1;
	}

	private renderContent(): void {
		const level = parseBooleanNumber(this.params.data?.[ROW_LEVEL_FIELD]);
		const hasChildren = parseBooleanString(this.params.data?.[ROW_HAS_CHILDREN_FIELD]);
		const isCollapsed = parseBooleanString(this.params.data?.[ROW_COLLAPSED_FIELD]);

		this.eGui.style.setProperty('--tlb-tree-level', String(level));
		this.toggleEl.hidden = !hasChildren;
		this.spacerEl.hidden = hasChildren;
		setIcon(this.toggleIconEl, isCollapsed ? 'chevron-right' : 'chevron-down');
		const toggleLabel = isCollapsed ? t('treeTitleCell.expandRow') : t('treeTitleCell.collapseRow');
		this.toggleEl.setAttribute('title', toggleLabel);

		const rawValue = this.getRawValue();
		const segments = parseCellLinkSegments(rawValue);
		const hasLink = segments.some((segment) => segment.kind === 'link');
		this.currentLinks = [];

		if (!hasLink) {
			this.textEl.textContent = this.getDisplayValue(this.params);
			return;
		}

		const doc = this.params.eGridCell?.ownerDocument ?? document;
		const fragment = doc.createDocumentFragment();

		for (const segment of segments) {
			if (segment.kind === 'text') {
				fragment.appendChild(doc.createTextNode(segment.text));
				continue;
			}

			const linkIndex = this.currentLinks.length;
			this.currentLinks.push(segment.link);

			const anchor = doc.createElement('a');
			anchor.className = 'tlb-link-cell__anchor';
			anchor.textContent = segment.text;
			anchor.href = '#';
			anchor.tabIndex = 0;
			anchor.dataset.linkIndex = String(linkIndex);
			fragment.appendChild(anchor);
		}

		this.textEl.replaceChildren(fragment);
	}

	private attachToggleEvents(): void {
		this.toggleClickHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.triggerToggle();
		};
		this.toggleMouseDownHandler = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
		};
		this.toggleKeydownHandler = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.triggerToggle();
		};

		this.toggleEl.addEventListener('click', this.toggleClickHandler);
		this.toggleEl.addEventListener('mousedown', this.toggleMouseDownHandler, true);
		this.toggleEl.addEventListener('keydown', this.toggleKeydownHandler);
	}

	private detachToggleEvents(): void {
		if (this.toggleClickHandler) {
			this.toggleEl.removeEventListener('click', this.toggleClickHandler);
		}
		if (this.toggleMouseDownHandler) {
			this.toggleEl.removeEventListener('mousedown', this.toggleMouseDownHandler, true);
		}
		if (this.toggleKeydownHandler) {
			this.toggleEl.removeEventListener('keydown', this.toggleKeydownHandler);
		}
	}

	private attachTextEvents(): void {
		this.textClickHandler = (event: MouseEvent) => {
			const link = this.getLinkFromEventTarget(event.target);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.triggerLinkOpen(link);
		};

		this.textMouseDownHandler = (event: MouseEvent) => {
			const link = this.getLinkFromEventTarget(event.target);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		};

		this.textKeydownHandler = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			const link = this.getLinkFromEventTarget(event.target);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.triggerLinkOpen(link);
		};

		this.textEl.addEventListener('click', this.textClickHandler, { capture: false });
		this.textEl.addEventListener('mousedown', this.textMouseDownHandler, { capture: true });
		this.textEl.addEventListener('keydown', this.textKeydownHandler, { capture: false });
	}

	private detachTextEvents(): void {
		if (this.textClickHandler) {
			this.textEl.removeEventListener('click', this.textClickHandler);
		}
		if (this.textMouseDownHandler) {
			this.textEl.removeEventListener('mousedown', this.textMouseDownHandler, true);
		}
		if (this.textKeydownHandler) {
			this.textEl.removeEventListener('keydown', this.textKeydownHandler);
		}
	}

	private triggerToggle(): void {
		const context = this.params.context as GridInteractionContext | undefined;
		const callback = context?.toggleTreeRowCollapse;
		if (!callback) {
			return;
		}
		const rowIndex = this.getBlockIndex();
		if (rowIndex === null) {
			return;
		}
		callback(rowIndex);
	}

	private triggerLinkOpen(link: DetectedCellLink): void {
		const context = this.params.context as GridInteractionContext | undefined;
		if (!context?.openCellLink) {
			return;
		}
		context.openCellLink({
			link,
			field: this.params.colDef?.field ?? null,
			rowId: this.getRowId(),
			rawValue: this.getRawValue()
		});
	}

	private getBlockIndex(): number | null {
		const data = this.params.data ?? null;
		if (!data) {
			return null;
		}
		const raw = data[ROW_ID_FIELD];
		const parsed = Number.parseInt(String(raw ?? ''), 10);
		return Number.isNaN(parsed) ? null : parsed;
	}

	private getRowId(): string | null {
		const fromNode = this.params.node?.id ?? null;
		if (fromNode) {
			return fromNode;
		}
		const data = this.params.data as Record<string, unknown> | null | undefined;
		const fallback = data ? data[ROW_ID_FIELD] : null;
		if (fallback == null) {
			return null;
		}
		const str = formatUnknownValue(fallback);
		return str.length > 0 ? str : null;
	}

	private getRawValue(): string {
		const value = this.params.value;
		return typeof value === 'string' ? value : value != null ? String(value) : '';
	}

	private getDisplayValue(params: ICellRendererParams): string {
		const formatted = params.valueFormatted;
		if (typeof formatted === 'string') {
			return formatted;
		}
		if (formatted != null) {
			return String(formatted);
		}
		const value = params.value;
		if (typeof value === 'string') {
			return value;
		}
		if (value == null) {
			return '';
		}
		return String(value);
	}

	private getLinkFromEventTarget(target: EventTarget | null): DetectedCellLink | null {
		if (!(target instanceof HTMLElement)) {
			return null;
		}
		const anchor = target.closest<HTMLElement>('.tlb-link-cell__anchor');
		if (!anchor || !this.textEl.contains(anchor)) {
			return null;
		}
		const indexText = anchor.dataset.linkIndex;
		if (!indexText) {
			return null;
		}
		const index = Number.parseInt(indexText, 10);
		if (!Number.isFinite(index) || index < 0 || index >= this.currentLinks.length) {
			return null;
		}
		return this.currentLinks[index] ?? null;
	}
}

function parseBooleanString(value: unknown): boolean {
	return value === true || value === 'true';
}

function parseBooleanNumber(value: unknown): number {
	const normalized =
		typeof value === 'number' || typeof value === 'string'
			? String(value)
			: '0';
	const parsed = Number.parseInt(normalized, 10);
	return Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
}

export function createTreeTitleCellRenderer(): { new(): TreeTitleCellRenderer } {
	return TreeTitleCellRenderer;
}
