import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';

interface SlideControllerOptions {
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	onExit: () => void;
}

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

export class SlideViewController {
	private readonly root: HTMLElement;
	private readonly stage: HTMLElement;
	private rows: RowData[] = [];
	private fields: string[] = [];
	private activeIndex = 0;
	private readonly cleanup: Array<() => void> = [];
	private readonly onExit: () => void;

	constructor(options: SlideControllerOptions) {
		this.rows = options.rows;
		this.fields = options.fields;
		this.onExit = options.onExit;
		this.root = options.container;
		this.root.empty();
		this.root.addClass('tlb-slide-full');
		this.stage = this.root.createDiv({ cls: 'tlb-slide-full__stage' });
		this.attachKeyboard();
		this.renderActive();
	}

	updateRows(rows: RowData[]): void {
		this.rows = rows;
		if (this.activeIndex >= this.rows.length) {
			this.activeIndex = Math.max(0, this.rows.length - 1);
		}
		this.renderActive();
	}

	destroy(): void {
		for (const dispose of this.cleanup) {
			try {
				dispose();
			} catch {
				// ignore
			}
		}
		this.root.empty();
	}

	private attachKeyboard(): void {
		const handler = (evt: KeyboardEvent) => {
			if (evt.defaultPrevented) return;
			if (evt.key === 'ArrowRight' || evt.key === ' ') {
				this.next();
				evt.preventDefault();
			} else if (evt.key === 'ArrowLeft') {
				this.prev();
				evt.preventDefault();
			} else if (evt.key === 'Escape') {
				evt.preventDefault();
				this.onExit();
			}
		};
		const owner = this.root.ownerDocument ?? document;
		owner.addEventListener('keydown', handler);
		this.cleanup.push(() => owner.removeEventListener('keydown', handler));
	}

	private next(): void {
		if (this.rows.length === 0) return;
		const nextIndex = Math.min(this.rows.length - 1, this.activeIndex + 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private prev(): void {
		if (this.rows.length === 0) return;
		const nextIndex = Math.max(0, this.activeIndex - 1);
		if (nextIndex !== this.activeIndex) {
			this.activeIndex = nextIndex;
			this.renderActive();
		}
	}

	private renderActive(): void {
		this.stage.empty();
		if (this.rows.length === 0) {
			this.stage.createDiv({
				cls: 'tlb-slide-full__empty',
				text: t('slideView.emptyState')
			});
			return;
		}
		const row = this.rows[this.activeIndex];
		const { title, contents } = this.resolveContent(row);
		const slide = this.stage.createDiv({
			cls: 'tlb-slide-full__slide',
			attr: { 'data-tlb-slide-index': String(this.activeIndex) }
		});
		slide.createDiv({ cls: 'tlb-slide-full__title', text: title });
		const content = slide.createDiv({ cls: 'tlb-slide-full__content' });
		if (contents.length === 0) {
			content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: t('slideView.emptyValue') });
		} else {
			for (const value of contents) {
				content.createDiv({ cls: 'tlb-slide-full__block', text: value });
			}
		}
	}

	private resolveContent(row: RowData): { title: string; contents: string[] } {
		const orderedFields = this.fields.filter((field) => field && !RESERVED_FIELDS.has(field));
		const values: Array<{ field: string; value: string }> = [];
		for (const field of orderedFields) {
			const raw = row[field];
			if (raw == null) continue;
			const text = String(raw).trim();
			if (!text) continue;
			values.push({ field, value: text });
		}
		const title = values.length > 0 ? values[0].value : t('slideView.untitledSlide', { index: String(this.activeIndex + 1) });
		const contents = values.slice(1).map((entry) => entry.value);
		return { title, contents };
	}
}
