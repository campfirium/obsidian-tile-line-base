export function computeOverlayBackground(
	baseColor: string | null | undefined,
	host: HTMLElement,
	ownerWindow: Window | null
): string {
	const candidate = parseColor(baseColor);
	const hostBg = parseColor(readHostBackground(host, ownerWindow));
	const parsed = candidate ?? hostBg;
	if (!parsed) {
		return 'var(--background-primary)';
	}
	const luminance = getLuminance(parsed);
	const factor = 0.08;
	const shifted = luminance < 0.45 ? lighten(parsed, factor) : darken(parsed, factor);
	return `rgb(${shifted.r}, ${shifted.g}, ${shifted.b})`;
}

function readHostBackground(host: HTMLElement, ownerWindow: Window | null): string {
	if (!ownerWindow) return '';
	const style = ownerWindow.getComputedStyle(host);
	const slideBg = style.getPropertyValue('--tlb-slide-full-bg')?.trim();
	if (slideBg) return slideBg;
	const primary = style.getPropertyValue('--background-primary')?.trim();
	return primary ?? '';
}

function parseColor(input: string | null | undefined): { r: number; g: number; b: number } | null {
	if (!input) return null;
	const value = input.trim();
	if (!value) return null;
	if (value.startsWith('#')) {
		const hex = value.slice(1);
		if (hex.length === 3) {
			return {
				r: parseInt(hex[0] + hex[0], 16),
				g: parseInt(hex[1] + hex[1], 16),
				b: parseInt(hex[2] + hex[2], 16)
			};
		}
		if (hex.length === 6) {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
				return { r, g, b };
			}
		}
	}
	const rgbMatch = value.match(/rgba?\(\s*([\d.]+)[^,]*,\s*([\d.]+)[^,]*,\s*([\d.]+)[^)]*\)/i);
	if (rgbMatch) {
		const r = Number(rgbMatch[1]);
		const g = Number(rgbMatch[2]);
		const b = Number(rgbMatch[3]);
		if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
			return {
				r: Math.round(clamp(r, 0, 255)),
				g: Math.round(clamp(g, 0, 255)),
				b: Math.round(clamp(b, 0, 255))
			};
		}
	}
	return null;
}

function lighten(color: { r: number; g: number; b: number }, factor: number): { r: number; g: number; b: number } {
	return {
		r: Math.round(clamp(color.r + (255 - color.r) * factor, 0, 255)),
		g: Math.round(clamp(color.g + (255 - color.g) * factor, 0, 255)),
		b: Math.round(clamp(color.b + (255 - color.b) * factor, 0, 255))
	};
}

function darken(color: { r: number; g: number; b: number }, factor: number): { r: number; g: number; b: number } {
	return {
		r: Math.round(clamp(color.r * (1 - factor), 0, 255)),
		g: Math.round(clamp(color.g * (1 - factor), 0, 255)),
		b: Math.round(clamp(color.b * (1 - factor), 0, 255))
	};
}

function getLuminance(color: { r: number; g: number; b: number }): number {
	const normalize = (channel: number) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	};
	const r = normalize(color.r);
	const g = normalize(color.g);
	const b = normalize(color.b);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
