import { getDefaultBodyLayout, getDefaultTitleLayout } from '../../types/slide';

export interface ComputedLayout {
	widthPct: number;
	topPct: number;
	insetPct: number;
	align: 'left' | 'center' | 'right';
	lineHeight: number;
	fontSize: number;
	fontWeight: number;
}

export function computeLayout(layout: unknown, kind: 'title' | 'body'): ComputedLayout {
	const defaults = kind === 'title' ? getDefaultTitleLayout() : getDefaultBodyLayout();
	const source = layout && typeof layout === 'object' ? (layout as any) : {};
	const widthPct = Math.min(100, Math.max(0, Number(source.widthPct ?? defaults.widthPct)));
	const topPct = Math.min(100, Math.max(0, Number(source.topPct ?? defaults.topPct)));
	const insetPct = Math.min(100, Math.max(0, Number(source.insetPct ?? defaults.insetPct)));
	const align: ComputedLayout['align'] =
		source.align === 'left' || source.align === 'right' || source.align === 'center'
			? source.align
			: defaults.align;
	const lineHeight = Number.isFinite(source.lineHeight) ? Number(source.lineHeight) : defaults.lineHeight;
	const fontSize = Number.isFinite(source.fontSize) ? Number(source.fontSize) : defaults.fontSize;
	const fontWeight = Number.isFinite(source.fontWeight) ? Number(source.fontWeight) : defaults.fontWeight;
	return { widthPct, topPct, insetPct, align, lineHeight, fontSize, fontWeight };
}

/* eslint-disable obsidianmd/no-static-styles-assignment */
export function applyLayoutStyles(el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement): void {
	el.classList.add('tlb-slide-layout');
	el.style.setProperty('--tlb-layout-width', `${layout.widthPct}%`);
	el.style.setProperty('--tlb-layout-text-align', layout.align);

	if (layout.align === 'center') {
		el.style.setProperty('--tlb-layout-left', '50%');
		el.style.setProperty('--tlb-layout-right', 'auto');
		el.style.setProperty('--tlb-layout-transform', 'translateX(-50%)');
	} else if (layout.align === 'right') {
		el.style.setProperty('--tlb-layout-left', 'auto');
		el.style.setProperty('--tlb-layout-right', `${layout.insetPct}%`);
		el.style.setProperty('--tlb-layout-transform', 'translateX(0)');
	} else {
		el.style.setProperty('--tlb-layout-left', `${layout.insetPct}%`);
		el.style.setProperty('--tlb-layout-right', 'auto');
		el.style.setProperty('--tlb-layout-transform', 'translateX(0)');
	}

	const usableHeight = Math.max(0, slideEl.clientHeight);
	const blockHeight = el.offsetHeight;
	const topPx = (usableHeight * layout.topPct) / 100;
	const maxTop = Math.max(0, usableHeight - blockHeight);
	el.style.setProperty('--tlb-layout-top', `${Math.min(topPx, maxTop)}px`);
}
/* eslint-enable obsidianmd/no-static-styles-assignment */
