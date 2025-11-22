import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';

interface SlideControllerOptions {
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	onExit: () => void;
	onEditTemplate: () => void;
}

const RESERVED_FIELDS = new Set(['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged']);

export class SlideViewController {
	private readonly root: HTMLElement;
	private readonly stage: HTMLElement;
	private readonly controls: HTMLElement;
	private rows: RowData[] = [];
	private fields: string[] = [];
	private config: SlideViewConfig;
	private activeIndex = 0;
	private readonly cleanup: Array<() => void> = [];
	private readonly onExit: () => void;
	private readonly onEditTemplate: () => void;
	private fullscreenTarget: HTMLElement | null = null;
	private isFullscreen = false;

	constructor(options: SlideControllerOptions) {
		this.rows = options.rows;
		this.fields = options.fields;
		this.config = options.config;
		this.onExit = options.onExit;
		this.onEditTemplate = options.onEditTemplate;
		this.root = options.container;
		this.root.empty();
		this.root.addClass('tlb-slide-full');
		this.controls = this.root.createDiv({ cls: 'tlb-slide-full__controls' });
		this.stage = this.root.createDiv({ cls: 'tlb-slide-full__stage' });
		this.fullscreenTarget = this.root;
		this.renderControls();
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

	updateConfig(config: SlideViewConfig): void {
		this.config = config;
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
		this.exitFullscreen();
		this.root.empty();
	}

	private renderControls(): void {
		const templateBtn = this.controls.createEl('button', {
			cls: 'tlb-slide-full__btn',
			attr: { 'aria-label': t('slideView.actions.openTemplate') }
		});
		setIcon(templateBtn, 'settings');
		templateBtn.addEventListener('click', (evt) => {
			evt.preventDefault();
			this.onEditTemplate();
		});

		const fullscreenBtn = this.controls.createEl('button', {
			cls: 'tlb-slide-full__btn',
			attr: { 'aria-label': t('slideView.actions.enterFullscreen') }
		});
		setIcon(fullscreenBtn, 'maximize-2');
		fullscreenBtn.addEventListener('click', (evt) => {
			evt.preventDefault();
			if (this.isFullscreen) {
				this.exitFullscreen();
				setIcon(fullscreenBtn, 'maximize-2');
				fullscreenBtn.setAttr('aria-label', t('slideView.actions.enterFullscreen'));
			} else {
				void this.enterFullscreen();
				setIcon(fullscreenBtn, 'minimize-2');
				fullscreenBtn.setAttr('aria-label', t('slideView.actions.exitFullscreen'));
			}
		});
	}

	private attachKeyboard(): void {
		const handler = (evt: KeyboardEvent) => {
			const target = evt.target as HTMLElement | null;
			const tag = target?.tagName?.toLowerCase();
			if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
				return;
			}
			if (evt.key === 'ArrowRight' || evt.key === ' ') {
				this.next();
				evt.preventDefault();
			} else if (evt.key === 'ArrowLeft') {
				this.prev();
				evt.preventDefault();
			} else if (evt.key === 'Escape') {
				evt.preventDefault();
				if (this.isFullscreen) {
					this.exitFullscreen();
					return;
				}
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
		const bgColor = (this.config.template.backgroundColor ?? '').trim();
		const titleColor = (this.config.template.titleColor ?? '').trim();
		const bodyColor = (this.config.template.bodyColor ?? '').trim();
		if (bgColor) {
			slide.style.background = bgColor;
		}
		if (titleColor) {
			slide.style.setProperty('--tlb-slide-title-color', titleColor);
		}
		if (bodyColor) {
			slide.style.setProperty('--tlb-slide-body-color', bodyColor);
		}
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
		const template = this.config.template;
		const values: Record<string, string> = {};
		for (const field of orderedFields) {
			if (field === 'status') continue;
			const raw = row[field];
			const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
			if (!text) continue;
			values[field] = text;
		}

		const renderTemplate = (templateText: string): string => {
			const input = templateText.replace(/\r\n/g, '\n');
			return input.replace(/\{([^{}]+)\}/g, (_, key: string) => {
				const field = key.trim();
				if (!field || RESERVED_FIELDS.has(field)) {
					return '';
				}
				return values[field] ?? '';
			}).trim();
		};

		const titleTemplate = template.titleTemplate || `{${orderedFields[0] ?? ''}}`;
		const title = renderTemplate(titleTemplate) || t('slideView.untitledSlide', { index: String(this.activeIndex + 1) });

		const body = renderTemplate(template.bodyTemplate);
		const contents = body ? body.split('\n').filter((line) => line.trim().length > 0) : [];
		return { title, contents };
	}

	private async enterFullscreen(): Promise<void> {
		if (!this.fullscreenTarget || this.isFullscreen) return;
		try {
			if (this.fullscreenTarget.requestFullscreen) {
				await this.fullscreenTarget.requestFullscreen();
				this.isFullscreen = true;
			}
		} catch {
			// ignore fullscreen errors
		}
	}

	private exitFullscreen(): void {
		if (!this.isFullscreen) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		}
		this.isFullscreen = false;
	}
}
