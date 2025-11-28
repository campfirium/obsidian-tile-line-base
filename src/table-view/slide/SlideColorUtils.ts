export function computeOverlayBackground(
	baseColor: string | null | undefined,
	host: HTMLElement,
	ownerWindow: Window | null
): string {
	const theme = resolveTheme(ownerWindow);
	const candidate = parseColor(baseColor);
	const hostBg = parseColor(readHostBackground(host, ownerWindow));
	const parsed = candidate ?? hostBg;
	if (!parsed) {
		return buildThemeAwareFallback(theme);
	}
	const shifted = theme === 'light' ? lighten(parsed, 0.65) : darken(parsed, 0.18);
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

type ThemeMode = 'light' | 'dark';

function resolveTheme(ownerWindow: Window | null): ThemeMode {
	const doc = ownerWindow?.document;
	if (doc?.body?.classList.contains('theme-light')) return 'light';
	if (doc?.body?.classList.contains('theme-dark')) return 'dark';
	if (ownerWindow?.matchMedia?.('(prefers-color-scheme: light)').matches) {
		return 'light';
	}
	return 'dark';
}

function buildThemeAwareFallback(theme: ThemeMode): string {
	if (theme === 'light') {
		return 'color-mix(in srgb, var(--background-primary) 88%, rgba(255, 255, 255, 0.72))';
	}
	return 'color-mix(in srgb, var(--background-primary) 76%, rgba(0, 0, 0, 0.42))';
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

export function toHexColor(input: string | null | undefined): string | null {
	const parsed = parseColor(input);
	if (!parsed) return null;
	const toHex = (value: number) => value.toString(16).padStart(2, '0');
	return `#${toHex(parsed.r)}${toHex(parsed.g)}${toHex(parsed.b)}`;
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
