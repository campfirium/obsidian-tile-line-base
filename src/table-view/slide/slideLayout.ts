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

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object';
}

const applyCssProps = (el: HTMLElement, props: Record<string, string>): void => {
	(el as HTMLElement & { setCssProps: (props: Record<string, string>) => void }).setCssProps(props);
};

export function computeLayout(layout: unknown, kind: 'title' | 'body'): ComputedLayout {
	const defaults = kind === 'title' ? getDefaultTitleLayout() : getDefaultBodyLayout();
	const source = isRecord(layout) ? layout : {};
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

export function applyLayoutStyles(el: HTMLElement, layout: ComputedLayout, slideEl: HTMLElement): void {
	el.classList.add('tlb-slide-layout');
	applyCssProps(el, {
		'--tlb-layout-width': String(layout.widthPct) + '%',
		'--tlb-layout-text-align': layout.align
	});

	const centerFromTop = Boolean(layout.centerFromTop);
	let transform = 'translateX(0)';
	if (layout.align === 'center') {
		applyCssProps(el, {
			'--tlb-layout-left': '50%',
			'--tlb-layout-right': 'auto'
		});
		transform = 'translateX(-50%)';
	} else if (layout.align === 'right') {
		applyCssProps(el, {
			'--tlb-layout-left': 'auto',
			'--tlb-layout-right': String(layout.insetPct) + '%'
		});
		transform = 'translateX(0)';
	} else {
		applyCssProps(el, {
			'--tlb-layout-left': String(layout.insetPct) + '%',
			'--tlb-layout-right': 'auto'
		});
		transform = 'translateX(0)';
	}
	if (centerFromTop) {
		transform = transform === 'translateX(-50%)'
			? 'translate(-50%, -50%)'
			: transform + ' translateY(-50%)';
	}
	applyCssProps(el, { '--tlb-layout-transform': transform });

	const usableHeight = Math.max(0, slideEl.clientHeight);
	const topPx = (usableHeight * layout.topPct) / 100;
	applyCssProps(el, { '--tlb-layout-top': String(topPx) + 'px' });

	if (layout.widthPct >= 99) {
		applyCssProps(el, {
			width: '100%',
			left: '0',
			right: '0',
			transform: 'none'
		});
	}
}
