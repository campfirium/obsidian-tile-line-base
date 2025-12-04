import { getDefaultBodyLayout, getDefaultTitleLayout } from '../../types/slide';

export interface ComputedLayout {
	widthPct: number;
	topPct: number;
	insetPct: number;
	align: 'left' | 'center' | 'right';
	lineHeight: number;
	fontSize: number;
	fontWeight: number;
	centerFromTop?: boolean;
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
	const centerFromTop = Boolean(source.centerFromTop);
	return { widthPct, topPct, insetPct, align, lineHeight, fontSize, fontWeight, centerFromTop };
}

/* eslint-disable obsidianmd/no-static-styles-assignment */
export function applyLayoutStyles(el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement): void {
	el.classList.add('tlb-slide-layout');
	el.style.setProperty('--tlb-layout-width', `${layout.widthPct}%`);
	el.style.setProperty('--tlb-layout-text-align', layout.align);

	const centerFromTop = Boolean(layout.centerFromTop);
	let transform = 'translateX(0)';
	if (layout.align === 'center') {
		el.style.setProperty('--tlb-layout-left', '50%');
		el.style.setProperty('--tlb-layout-right', 'auto');
		transform = 'translateX(-50%)';
	} else if (layout.align === 'right') {
		el.style.setProperty('--tlb-layout-left', 'auto');
		el.style.setProperty('--tlb-layout-right', `${layout.insetPct}%`);
		transform = 'translateX(0)';
	} else {
		el.style.setProperty('--tlb-layout-left', `${layout.insetPct}%`);
		el.style.setProperty('--tlb-layout-right', 'auto');
		transform = 'translateX(0)';
	}
	if (centerFromTop) {
		transform = transform === 'translateX(-50%)' ? 'translate(-50%, -50%)' : `${transform} translateY(-50%)`;
	}
	el.style.setProperty('--tlb-layout-transform', transform);

	const usableHeight = Math.max(0, slideEl.clientHeight);
	const topPx = (usableHeight * layout.topPct) / 100;
	el.style.setProperty('--tlb-layout-top', `${topPx}px`);

	if (layout.widthPct >= 99) {
		el.style.width = '100%';
		el.style.left = '0';
		el.style.right = '0';
		el.style.transform = 'none';
	}
}
/* eslint-enable obsidianmd/no-static-styles-assignment */
