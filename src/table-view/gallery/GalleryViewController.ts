import { App, Component } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import type { GlobalQuickFilterManager } from '../filter/GlobalQuickFilterManager';
import { buildSlidePages, type SlidePage } from '../slide/SlidePageBuilder';
import { RESERVED_SLIDE_FIELDS } from '../slide/slideDefaults';
import {
	applyLayoutWithWatcher,
	buildSlideMarkdown,
	renderMarkdownBlock,
	resetRenderArtifacts
} from '../slide/SlideRenderUtils';
import { applyLayoutStyles } from '../slide/slideLayout';
import { renderSlideEditForm, serializeTemplateSegments, type EditState } from '../slide/slideTemplateEditing';

interface GalleryViewControllerOptions {
	app: App;
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	sourcePath: string;
	onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	onTemplateChange?: () => void;
	quickFilterManager?: GlobalQuickFilterManager | null;
	subscribeToRows?: (listener: (rows: RowData[]) => void) => () => void;
}

type EditingKey = { rowIndex: number; templateRef: SlidePage['templateRef'] } | null;

export class GalleryViewController {
	private readonly app: App;
	private readonly container: HTMLElement;
	private rows: RowData[] = [];
	private visibleRows: RowData[] = [];
	private fields: string[] = [];
	private config: SlideViewConfig;
	private pages: SlidePage[] = [];
	private readonly renderCleanup: Array<() => void> = [];
	private readonly markdownComponents: Component[] = [];
	private editingKey: EditingKey = null;
	private readonly editState: EditState = { template: null, values: {}, fieldInputs: {} };
	private readonly onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	private readonly sourcePath: string;
	private readonly onTemplateChange: (() => void) | null;
	private readonly quickFilterManager: GlobalQuickFilterManager | null;
	private quickFilterValue = '';
	private unsubscribeRows: (() => void) | null = null;
	private unsubscribeQuickFilter: (() => void) | null = null;

	constructor(options: GalleryViewControllerOptions) {
		this.app = options.app;
		this.container = options.container;
		this.rows = options.rows;
		this.fields = options.fields;
		this.config = options.config;
		this.sourcePath = options.sourcePath;
		this.onSaveRow = options.onSaveRow;
		this.onTemplateChange = options.onTemplateChange ?? null;
		this.quickFilterManager = options.quickFilterManager ?? null;
		this.quickFilterValue = this.quickFilterManager?.getValue() ?? '';
		if (options.subscribeToRows) {
			this.unsubscribeRows = options.subscribeToRows((rows) => {
				this.rows = rows;
				this.render();
			});
		}
		if (this.quickFilterManager) {
			this.unsubscribeQuickFilter = this.quickFilterManager.subscribe((value) => {
				this.quickFilterValue = value ?? '';
				this.render();
			});
		}
		this.render();
	}

	updateRows(rows: RowData[]): void {
		this.rows = rows;
		this.render();
	}

	updateConfig(config: SlideViewConfig): void {
		this.config = config;
		this.render();
	}

	destroy(): void {
		this.unsubscribeRows?.();
		this.unsubscribeRows = null;
		this.unsubscribeQuickFilter?.();
		this.unsubscribeQuickFilter = null;
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		this.container.empty();
	}

	private render(): void {
		resetRenderArtifacts(this.renderCleanup, this.markdownComponents);
		this.container.empty();
		this.visibleRows = this.filterRows(this.rows);
		this.pages = buildSlidePages({
			rows: this.visibleRows,
			fields: this.fields,
			config: this.config,
			reservedFields: RESERVED_SLIDE_FIELDS
		});
		if (this.editingKey && !this.pages.some((page) => this.isEditingPage(page))) {
			this.clearEditingState();
		}
		if (this.pages.length === 0) {
			this.container.createDiv({ cls: 'tlb-gallery-empty', text: t('galleryView.emptyState') });
			return;
		}

		const grid = this.container.createDiv({ cls: 'tlb-gallery-grid' });
		this.pages.forEach((page, index) => {
			const card = grid.createDiv({
				cls: 'tlb-gallery-card',
				attr: { 'data-tlb-gallery-index': String(index) }
			});
			const slideEl = card.createDiv({ cls: 'tlb-slide-full__slide tlb-gallery-card__slide' });
			this.applySlideColors(slideEl, page.textColor, page.backgroundColor);
			const row = this.visibleRows[page.rowIndex];
			const applyLayout = (el: HTMLElement, layout: SlidePage['titleLayout']) =>
				applyLayoutWithWatcher(this.renderCleanup, el, layout, slideEl, (target, layoutSpec, container) =>
					applyLayoutStyles(target, layoutSpec, container));
			const isEditing = this.isEditingPage(page);

			if (isEditing) {
				renderSlideEditForm({
					container: slideEl,
					row,
					page,
					fields: this.fields,
					reservedFields: RESERVED_SLIDE_FIELDS,
					state: this.editState,
					position: applyLayout,
					onCancel: () => {
						this.clearEditingState();
						this.render();
					},
					onSave: () => {
						void this.persistEdit(page);
					}
				});
			} else {
				this.renderDisplayCard({
					slideEl,
					page,
					applyLayout
				});
				card.addEventListener('click', (evt) => {
					if (evt.defaultPrevented) return;
					this.beginEdit(page, row);
				});
			}
		});
	}

	private renderDisplayCard(options: {
		slideEl: HTMLElement;
		page: SlidePage;
		applyLayout: (el: HTMLElement, layout: SlidePage['titleLayout']) => void;
	}): void {
		const { slideEl, page, applyLayout } = options;
		const titleEl = slideEl.createDiv({ cls: 'tlb-slide-full__title', text: page.title });
		titleEl.style.lineHeight = `${page.titleLayout.lineHeight}`;
		titleEl.style.fontSize = `${page.titleLayout.fontSize}rem`;
		titleEl.style.fontWeight = String(page.titleLayout.fontWeight);
		applyLayout(titleEl, page.titleLayout);

		if (page.textBlocks.length === 0 && page.imageBlocks.length === 0) {
			const content = slideEl.createDiv({ cls: 'tlb-slide-full__content' });
			content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--empty', text: '' });
			applyLayout(content, page.textLayout);
			return;
		}

		if (page.textBlocks.length > 0) {
			const content = slideEl.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--text' });
			const bodyBlock = content.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--text' });
			bodyBlock.style.lineHeight = `${page.textLayout.lineHeight}`;
			bodyBlock.style.fontSize = `${page.textLayout.fontSize}rem`;
			bodyBlock.style.fontWeight = String(page.textLayout.fontWeight);
			bodyBlock.style.textAlign = page.textLayout.align;
			renderMarkdownBlock(
				this.app,
				buildSlideMarkdown(page.textBlocks),
				bodyBlock,
				this.sourcePath,
				this.markdownComponents
			);
			applyLayout(content, page.textLayout);
		}

		if (page.imageBlocks.length > 0) {
			const imageWrapper = slideEl.createDiv({ cls: 'tlb-slide-full__content tlb-slide-full__layer--image' });
			for (const img of page.imageBlocks) {
				const imageBlock = imageWrapper.createDiv({ cls: 'tlb-slide-full__block tlb-slide-full__block--image' });
				imageBlock.style.textAlign = page.imageLayout.align;
				renderMarkdownBlock(this.app, img, imageBlock, this.sourcePath, this.markdownComponents);
			}
			applyLayout(imageWrapper, page.imageLayout);
		}
	}

	private beginEdit(page: SlidePage, row: RowData): void {
		this.editingKey = { rowIndex: page.rowIndex, templateRef: page.templateRef };
		const editableFields = this.fields.filter((field) => field && !RESERVED_SLIDE_FIELDS.has(field));
		const values: Record<string, string> = {};
		for (const field of editableFields) {
			const raw = row[field];
			values[field] = typeof raw === 'string' ? raw : String(raw ?? '');
		}
		this.editState.values = values;
		this.editState.fieldInputs = {};
		this.editState.template = null;
		this.render();
	}

	private async persistEdit(page: SlidePage): Promise<void> {
		if (!this.editState.template) return;
		const { titleTemplate, bodyTemplate } = serializeTemplateSegments(this.editState.template);
		page.updateTemplate({
			...page.templateRef,
			titleTemplate,
			bodyTemplate
		});
		this.onTemplateChange?.();
		const row = this.visibleRows[page.rowIndex];
		if (!row) {
			this.clearEditingState();
			this.render();
			return;
		}
		const nextRows = await this.onSaveRow(row, this.editState.values);
		if (nextRows) {
			this.updateRows(nextRows);
		} else {
			this.render();
		}
		this.clearEditingState();
	}

	private applySlideColors(slide: HTMLElement, textColor: string, backgroundColor: string): void {
		if (backgroundColor) {
			slide.style.setProperty('--tlb-slide-card-bg', backgroundColor);
		} else {
			slide.style.removeProperty('--tlb-slide-card-bg');
		}
		if (textColor) {
			slide.style.setProperty('--tlb-slide-text-color', textColor);
		} else {
			slide.style.removeProperty('--tlb-slide-text-color');
		}
	}

	private clearEditingState(): void {
		this.editState.template = null;
		this.editingKey = null;
	}

	private isEditingPage(page: SlidePage): boolean {
		return Boolean(
			this.editingKey &&
				this.editingKey.rowIndex === page.rowIndex &&
				this.editingKey.templateRef === page.templateRef
		);
	}

	private filterRows(rows: RowData[]): RowData[] {
		const needle = this.quickFilterValue.trim().toLowerCase();
		if (!needle) {
			return rows;
		}
		return rows.filter((row) => this.matchesQuickFilter(row, needle));
	}

	private matchesQuickFilter(row: RowData, needle: string): boolean {
		for (const field of this.fields) {
			if (!field) {
				continue;
			}
			const value = row[field];
			const text = typeof value === 'string' ? value : value != null ? String(value) : '';
			if (text && text.toLowerCase().includes(needle)) {
				return true;
			}
		}
		return false;
	}
}
