import { App, setIcon } from 'obsidian';
import { t } from '../../i18n';
import {
	collectLucideIconIds,
	getFuzzyMatchScore,
	normalizeIconQuery,
	resolveCanonicalIconId,
	sanitizeIconId
} from './IconUtils';

export interface IconPickerOptions {
	app: App;
	container: HTMLElement;
	initialIcon?: string | null;
	allowClear?: boolean;
	onChange?: (value: string | null) => void;
	onOpen?: () => void;
	onClose?: () => void;
}

export interface IconPickerHandle {
	getValue(): string | null;
	setValue(value: string | null): void;
	focusTrigger(): void;
	close(): void;
	destroy(): void;
}

export function createIconPicker(options: IconPickerOptions): IconPickerHandle {
	const picker = new IconPicker(options);
	return {
		getValue: () => picker.getValue(),
		setValue: (value) => picker.setValue(value),
		focusTrigger: () => picker.focusTrigger(),
		close: () => picker.closePanel(),
		destroy: () => picker.destroy()
	};
}

const ICON_GRID_COLUMNS = 12;
const ICON_GRID_ROWS = 10;
const ICON_NAV_SLOT_COUNT = 2;
const ICON_NAV_GAP_COLUMNS = 1;
const ICON_NAV_FIRST_COLUMN = ICON_GRID_COLUMNS - ICON_NAV_SLOT_COUNT;
const ICON_MATCHES_PER_PAGE = ICON_GRID_COLUMNS * ICON_GRID_ROWS - ICON_NAV_SLOT_COUNT - ICON_NAV_GAP_COLUMNS;

const applyCssProps = (el: HTMLElement, props: Record<string, string>): void => {
	(el as HTMLElement & { setCssProps: (props: Record<string, string>) => void }).setCssProps(props);
};

class IconPicker {
	private readonly options: IconPickerOptions;
	private readonly wrapper: HTMLElement;
	private readonly triggerEl: HTMLButtonElement;
	private readonly triggerIconEl: HTMLSpanElement;
	private readonly triggerLabelEl: HTMLSpanElement;
	private readonly doc: Document;
	private icons: string[] = [];
	private panelEl: HTMLElement | null = null;
	private panelContentEl: HTMLElement | null = null;
	private backdropEl: HTMLElement | null = null;
	private iconInputEl: HTMLInputElement | null = null;
	private iconMatchesEl: HTMLElement | null = null;
	private iconPage = 0;
	private iconQueryNormalized = '';
	private currentIcon: string | null;
	private lastEmittedIcon: string | null;
	private cleanupFns: Array<() => void> = [];

	private readonly handleOutsidePointer = (event: MouseEvent) => {
		if (!this.panelEl) {
			return;
		}
		const target = event.target as Node | null;
		if (target && (this.panelEl.contains(target) || this.triggerEl.contains(target))) {
			return;
		}
		this.closePanel();
	};

	private readonly handleGlobalKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			this.closePanel();
			this.triggerEl.focus();
		}
	};

	private readonly handleFocusIn = (event: FocusEvent) => {
		if (!this.panelEl) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (target && this.panelEl.contains(target)) {
			return;
		}
		this.iconInputEl?.focus({ preventScroll: true });
	};

	constructor(options: IconPickerOptions) {
		this.options = options;
		this.doc = options.container.ownerDocument ?? document;
		this.wrapper = options.container.createDiv({ cls: 'tlb-icon-picker tlb-icon-picker--inline' });
		this.triggerEl = this.wrapper.createEl('button', {
			type: 'button',
			cls: 'tlb-icon-picker__trigger',
			attr: {
				'aria-label': t('filterViewModals.iconPickerTooltip'),
				'aria-expanded': 'false',
				'aria-haspopup': 'dialog'
			}
		});
		this.triggerIconEl = this.triggerEl.createSpan({ cls: 'tlb-icon-picker__trigger-icon' });
		this.triggerLabelEl = this.triggerEl.createSpan({ cls: 'tlb-icon-picker__trigger-label' });
		this.triggerEl.addEventListener('click', () => this.togglePanel());

		this.currentIcon = sanitizeIconId(options.initialIcon);
		this.lastEmittedIcon = this.currentIcon;
		this.ensureIconOptions();
		this.currentIcon = resolveCanonicalIconId(this.currentIcon, this.icons);
		this.updateTrigger();
	}

	getValue(): string | null {
		return this.currentIcon ?? null;
	}

	setValue(value: string | null): void {
		const sanitized = sanitizeIconId(value);
		const canonical = resolveCanonicalIconId(sanitized, this.ensureIconOptions());
		this.currentIcon = canonical;
		this.updateTrigger();
		this.emitChangeIfNeeded();
	}

	focusTrigger(): void {
		this.triggerEl.focus();
	}

	private togglePanel(): void {
		if (this.panelEl) {
			this.closePanel();
		} else {
			this.openPanel();
		}
	}

	private openPanel(): void {
		if (this.panelEl) {
			return;
		}
		const portalRoot = this.doc.body?.createDiv({ cls: 'tlb-icon-picker__portal' }) ?? this.wrapper.createDiv();
		this.ensureIconOptions();
		this.iconPage = 0;
		this.iconQueryNormalized = '';
		this.triggerEl.setAttribute('aria-expanded', 'true');

		this.backdropEl = portalRoot.createDiv({ cls: 'tlb-icon-picker__backdrop' });
		this.backdropEl.addEventListener('click', () => this.closePanel());

		this.panelEl = portalRoot.createDiv({ cls: 'tlb-icon-picker__panel' });
		this.panelEl.addEventListener('mousedown', (event) => event.stopPropagation());
		this.panelEl.addEventListener('click', (event) => event.stopPropagation());
		this.panelContentEl = this.panelEl.createDiv({
			cls: 'tlb-icon-picker__panel-body tlb-filter-view-icon-control'
		});

		const headerRow = this.panelContentEl.createDiv({
			cls: 'tlb-icon-picker__header tlb-filter-view-icon-header-row'
		});
		const searchField = headerRow.createDiv({ cls: 'tlb-filter-view-icon-search-field' });
		const searchIcon = searchField.createSpan({ cls: 'tlb-filter-view-icon-search-field__icon' });
		setIcon(searchIcon, 'search');
		searchIcon.setAttribute('aria-hidden', 'true');
		this.iconInputEl = searchField.createEl('input', {
			type: 'text',
			cls: 'tlb-filter-view-icon-search-field__input',
			placeholder: t('filterViewModals.iconPickerPlaceholder')
		});
		this.iconInputEl.addEventListener('mousedown', (event) => event.stopPropagation());
		this.iconInputEl.value = this.currentIcon ?? '';
		this.iconInputEl.addEventListener('input', () => this.handleIconInput(this.iconInputEl!.value));

		const trailingActions = headerRow.createDiv({ cls: 'tlb-icon-picker__actions' });
		if (this.options.allowClear !== false) {
			const clearButton = trailingActions.createEl('button', {
				type: 'button',
				cls: 'tlb-icon-picker__clear',
				text: t('filterViewModals.iconStatusEmpty')
			});
			clearButton.addEventListener('click', () => this.applySelection(null, true));
		}
		const closeButton = trailingActions.createEl('button', {
			type: 'button',
			cls: 'tlb-icon-picker__close',
			attr: { 'aria-label': t('filterViewModals.cancelButton') }
		});
		setIcon(closeButton, 'x');
		closeButton.addEventListener('click', () => this.closePanel());

		this.iconMatchesEl = this.panelContentEl.createDiv({ cls: 'tlb-filter-view-icon-matches' });
		this.renderIconMatches(this.iconInputEl.value);

		this.doc.addEventListener('mousedown', this.handleOutsidePointer, true);
		this.doc.addEventListener('keydown', this.handleGlobalKeydown, true);
		this.doc.addEventListener('focusin', this.handleFocusIn, true);
		const resizeHandler = () => this.positionPanel();
		this.doc.defaultView?.addEventListener('resize', resizeHandler);
		this.doc.defaultView?.addEventListener('scroll', resizeHandler, true);
		this.cleanupFns.push(() => this.doc.defaultView?.removeEventListener('resize', resizeHandler));
		this.cleanupFns.push(() => this.doc.defaultView?.removeEventListener('scroll', resizeHandler, true));
		this.positionPanel();
		this.options.onOpen?.();
		setTimeout(() => {
			if (this.iconInputEl) {
				this.iconInputEl.focus({ preventScroll: true });
				this.iconInputEl.select();
			}
		}, 5);
	}

	closePanel(): void {
		if (!this.panelEl) {
			return;
		}
		const portal = this.panelEl.parentElement;
		this.triggerEl.setAttribute('aria-expanded', 'false');
		this.doc.removeEventListener('mousedown', this.handleOutsidePointer, true);
		this.doc.removeEventListener('keydown', this.handleGlobalKeydown, true);
		this.doc.removeEventListener('focusin', this.handleFocusIn, true);
		while (this.cleanupFns.length) {
			const cleanup = this.cleanupFns.pop();
			try {
				cleanup?.();
			} catch {
				// ignore cleanup errors
			}
		}
		this.panelEl.remove();
		this.backdropEl?.remove();
		if (portal && portal !== this.wrapper) {
			portal.remove();
		}
		this.panelEl = null;
		this.backdropEl = null;
		this.panelContentEl = null;
		this.iconMatchesEl = null;
		this.iconInputEl = null;
		this.triggerEl.focus({ preventScroll: true });
		this.options.onClose?.();
	}

	private ensureIconOptions(): string[] {
		if (this.icons.length === 0) {
			this.icons = collectLucideIconIds(this.options.app);
		}
		return this.icons;
	}

	private handleIconInput(value: string): void {
		const sanitized = sanitizeIconId(value);
		const canonical = resolveCanonicalIconId(sanitized, this.icons);
		if (!sanitized) {
			this.applySelection(null, false, { skipRender: true });
		} else if (canonical) {
			this.applySelection(canonical, false, { skipRender: true });
		}
		this.renderIconMatches(value);
	}

	private applySelection(
		value: string | null,
		shouldClose: boolean,
		options?: { skipRender?: boolean }
	): void {
		const sanitized = sanitizeIconId(value);
		const canonical = resolveCanonicalIconId(sanitized, this.icons);
		const next = canonical ?? null;
		this.currentIcon = next;
		if (!options?.skipRender) {
			this.updateTrigger();
			this.renderIconMatches(this.iconInputEl?.value ?? '');
		}
		this.emitChangeIfNeeded();
		if (shouldClose) {
			this.closePanel();
			this.triggerEl.focus();
		}
	}

	private emitChangeIfNeeded(): void {
		if (this.lastEmittedIcon === this.currentIcon) {
			return;
		}
		this.lastEmittedIcon = this.currentIcon;
		this.options.onChange?.(this.currentIcon);
	}

	private renderIconMatches(query: string): boolean {
		if (!this.iconMatchesEl) {
			return false;
		}
		const icons = this.ensureIconOptions();
		const normalizedQuery = normalizeIconQuery(query) ?? '';
		if (normalizedQuery !== this.iconQueryNormalized) {
			this.iconPage = 0;
			this.iconQueryNormalized = normalizedQuery;
		}

		type IconMatch = { iconId: string; score: number };
		const matches: IconMatch[] = [];
		if (!normalizedQuery) {
			icons.forEach((iconId, index) => {
				matches.push({ iconId, score: index });
			});
		} else {
			for (const iconId of icons) {
				const normalizedIcon = normalizeIconQuery(iconId);
				if (normalizedIcon === normalizedQuery) {
					matches.push({ iconId, score: -100 });
					continue;
				}
				const directIndex = normalizedIcon.indexOf(normalizedQuery);
				if (directIndex !== -1) {
					matches.push({ iconId, score: directIndex });
					continue;
				}
				const fuzzyScore = getFuzzyMatchScore(normalizedIcon, normalizedQuery);
				if (fuzzyScore !== null) {
					matches.push({ iconId, score: 1000 + fuzzyScore });
				}
			}
		}

		matches.sort((a, b) => a.score - b.score || a.iconId.localeCompare(b.iconId));
		const results = matches.map((match) => match.iconId);

		this.iconMatchesEl.empty();
		if (results.length === 0) {
			this.iconMatchesEl.createSpan({
				cls: 'tlb-filter-view-icon-matches__empty',
				text: t('filterViewModals.iconMatchesEmpty')
			});
			return false;
		}

		const pageCount = Math.max(1, Math.ceil(results.length / ICON_MATCHES_PER_PAGE));
		if (this.iconPage >= pageCount) {
			this.iconPage = pageCount - 1;
		}
		const row = this.iconMatchesEl.createDiv({ cls: 'tlb-filter-view-icon-matches-row' });
		const grid = row.createDiv({ cls: 'tlb-filter-view-icon-matches-grid' });
		const start = this.iconPage * ICON_MATCHES_PER_PAGE;
		const visible = results.slice(start, start + ICON_MATCHES_PER_PAGE);
		const selectedNormalized = this.currentIcon ? normalizeIconQuery(this.currentIcon) : null;
		const iconSlotPositions: Array<{ row: number; column: number }> = [];
		const gapSlotPositions: Array<{ row: number; column: number }> = [];
		for (let rowIndex = 0; rowIndex < ICON_GRID_ROWS; rowIndex += 1) {
			for (let columnIndex = 0; columnIndex < ICON_GRID_COLUMNS; columnIndex += 1) {
				const isLastRow = rowIndex === ICON_GRID_ROWS - 1;
				const isNavSlot = isLastRow && columnIndex >= ICON_NAV_FIRST_COLUMN;
				const isGapSlot =
					isLastRow &&
					columnIndex >= Math.max(0, ICON_NAV_FIRST_COLUMN - ICON_NAV_GAP_COLUMNS) &&
					columnIndex < ICON_NAV_FIRST_COLUMN;
				if (isNavSlot) {
					continue;
				}
				if (isGapSlot) {
					gapSlotPositions.push({ row: rowIndex, column: columnIndex });
					continue;
				}
				iconSlotPositions.push({ row: rowIndex, column: columnIndex });
			}
		}
		const applyGridPosition = (element: HTMLElement, position: { row: number; column: number }): void => {
			element.classList.add(
				`tlb-filter-view-icon-cell-row-${position.row + 1}`,
				`tlb-filter-view-icon-cell-col-${position.column + 1}`
			);
		};

		for (let slotIndex = 0; slotIndex < iconSlotPositions.length; slotIndex += 1) {
			const position = iconSlotPositions[slotIndex];
			if (slotIndex < visible.length) {
				const iconId = visible[slotIndex];
				const button = grid.createEl('button', {
					type: 'button',
					cls: 'tlb-filter-view-icon-match'
				});
				button.setAttribute('aria-label', t('filterViewModals.iconMatchAriaLabel', { icon: iconId }));
				const iconSpan = button.createSpan({ cls: 'tlb-filter-view-icon-match__icon' });
				setIcon(iconSpan, iconId);
				if (selectedNormalized && normalizeIconQuery(iconId) === selectedNormalized) {
					button.classList.add('is-active');
				}
				button.addEventListener('click', () => {
					this.applySelection(iconId, true);
				});
				applyGridPosition(button, position);
			} else {
				const placeholder = grid.createSpan({ cls: 'tlb-filter-view-icon-placeholder' });
				applyGridPosition(placeholder, position);
			}
		}

		for (const gapPosition of gapSlotPositions) {
			const gap = grid.createSpan({
				cls: 'tlb-filter-view-icon-placeholder tlb-filter-view-icon-placeholder--gap'
			});
			applyGridPosition(gap, gapPosition);
		}

		const prev = grid.createEl('button', {
			type: 'button',
			cls: 'tlb-filter-view-icon-match tlb-filter-view-icon-nav tlb-filter-view-icon-nav--prev'
		});
		prev.setAttribute('aria-label', t('filterViewModals.iconNavPrev'));
		const prevIcon = prev.createSpan({
			cls: 'tlb-filter-view-icon-match__icon tlb-filter-view-icon-match__icon--nav'
		});
		setIcon(prevIcon, 'chevron-left');
		applyGridPosition(prev, {
			row: ICON_GRID_ROWS - 1,
			column: ICON_NAV_FIRST_COLUMN
		});
		prev.disabled = pageCount <= 1 || this.iconPage === 0;
		prev.addEventListener('click', () => {
			if (this.iconPage > 0) {
				this.iconPage -= 1;
				this.renderIconMatches(this.iconInputEl?.value ?? '');
			}
		});

		const next = grid.createEl('button', {
			type: 'button',
			cls: 'tlb-filter-view-icon-match tlb-filter-view-icon-nav tlb-filter-view-icon-nav--right'
		});
		next.setAttribute('aria-label', t('filterViewModals.iconNavNext'));
		const nextIcon = next.createSpan({
			cls: 'tlb-filter-view-icon-match__icon tlb-filter-view-icon-match__icon--nav'
		});
		setIcon(nextIcon, 'chevron-right');
		applyGridPosition(next, {
			row: ICON_GRID_ROWS - 1,
			column: ICON_GRID_COLUMNS - 1
		});
		next.disabled = pageCount <= 1 || this.iconPage >= pageCount - 1;
		next.addEventListener('click', () => {
			if (this.iconPage < pageCount - 1) {
				this.iconPage += 1;
				this.renderIconMatches(this.iconInputEl?.value ?? '');
			}
		});

		return true;
	}

	private positionPanel(): void {
		if (!this.panelEl) {
			return;
		}
		const view = this.doc.defaultView ?? window;
		const anchorRect = this.triggerEl.getBoundingClientRect();
		const viewportPadding = 12;
		const maxWidth = Math.min(900, view.innerWidth - viewportPadding * 2);
		const targetWidth = Math.max(600, Math.min(maxWidth, (anchorRect.width || 0) * 1.5));
		let left = anchorRect.left + view.scrollX;
		if (!Number.isFinite(left)) {
			left = view.innerWidth / 2 - targetWidth / 2 + view.scrollX;
		}
		if (left + targetWidth + viewportPadding > view.innerWidth + view.scrollX) {
			left = view.innerWidth + view.scrollX - targetWidth - viewportPadding;
		}
		left = Math.max(viewportPadding + view.scrollX, left);
		const measuredHeight = this.panelEl.getBoundingClientRect().height;
		const panelHeight = measuredHeight && measuredHeight > 0 ? measuredHeight : 380;
		let top = anchorRect.bottom + 8 + view.scrollY;
		if (top + panelHeight + viewportPadding > view.innerHeight + view.scrollY) {
			const aboveTop = anchorRect.top + view.scrollY - panelHeight - 8;
			if (aboveTop > viewportPadding + view.scrollY) {
				top = aboveTop;
			} else {
				top = Math.max(viewportPadding + view.scrollY, view.innerHeight / 2 - panelHeight / 2 + view.scrollY);
			}
		}
		if (!Number.isFinite(anchorRect.height) || anchorRect.height === 0) {
			top = Math.max(viewportPadding + view.scrollY, view.innerHeight / 2 - panelHeight / 2 + view.scrollY);
		}
		applyCssProps(this.panelEl, {
			position: 'fixed',
			left: String(left) + 'px',
			top: String(top) + 'px',
			width: String(targetWidth) + 'px'
		});
		if (this.panelContentEl) {
			applyCssProps(this.panelContentEl, {
				'--tlb-filter-view-icon-grid-columns': String(ICON_GRID_COLUMNS),
				'--tlb-filter-view-icon-grid-rows': String(ICON_GRID_ROWS),
				'--tlb-filter-view-icon-cell-size': '40px',
				'--tlb-filter-view-icon-size': '22px',
				'--tlb-filter-view-icon-nav-icon-size': '26px'
			});
		}
	}

	private updateTrigger(): void {
		this.triggerIconEl.replaceChildren();
		if (this.currentIcon) {
			setIcon(this.triggerIconEl, this.currentIcon);
			this.triggerLabelEl.setText(t('filterViewModals.iconPickerTooltip'));
			this.triggerEl.setAttribute('title', t('filterViewModals.iconPickerTooltip'));
			this.triggerEl.classList.remove('is-empty');
		} else {
			setIcon(this.triggerIconEl, 'plus');
			this.triggerLabelEl.setText(t('filterViewModals.iconLabel'));
			this.triggerEl.setAttribute('title', t('filterViewModals.iconPickerTooltip'));
			this.triggerEl.classList.add('is-empty');
		}
	}

	destroy(): void {
		this.closePanel();
		this.triggerEl.replaceChildren();
		this.wrapper.replaceWith();
	}
}
