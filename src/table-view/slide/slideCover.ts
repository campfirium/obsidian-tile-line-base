import type { ComputedLayout } from './slideLayout';

export const COVER_LAYOUT: ComputedLayout = {
	align: 'center',
	fontSize: 2.5,
	fontWeight: 700,
	insetPct: 0,
	lineHeight: 1.2,
	topPct: 38,
	widthPct: 62
};

export const COVER_HIDDEN_CLASS = 'tlb-slide-full__cover--hidden';

export const resolveSourceTitle = (sourcePath: string): string | null => {
	const normalized = sourcePath.trim();
	if (!normalized) {
		return null;
	}
	const segments = normalized.split(/[\\/]/);
	const last = segments[segments.length - 1] ?? '';
	if (!last) {
		return null;
	}
	return last.replace(/\.md$/i, '') || last;
};
