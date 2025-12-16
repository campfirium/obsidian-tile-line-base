import type { BorderColorMode, StripeColorMode } from '../types/appearance';

type RgbColor = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// Prevent hover overlays from fully replacing the base background when themes supply opaque values.
const clampHoverWeight = (value: number | null, isDarkMode: boolean): number => {
	const maxHoverWeight = isDarkMode ? 0.24 : 0.18;
	const fallbackWeight = isDarkMode ? 0.16 : 0.1;
	if (value === null || Number.isNaN(value)) { return fallbackWeight; }
	return clamp(value, 0, maxHoverWeight);
};

const resolveHoverOverlayWeight = (hoverValue: string, isDarkMode: boolean): number => {
	const numeric = hoverValue.match(/[\d.]+/g);
	const alphaValue = numeric && numeric.length >= 4 ? Number(numeric[3]) : null;
	const hasExplicitAlpha = typeof alphaValue === 'number' && Number.isFinite(alphaValue);
	if (hasExplicitAlpha) {
		return clampHoverWeight(alphaValue, isDarkMode);
	}
	// No explicit alpha: theme likely provided an opaque color, fall back to a softened weight only in this case.
	return clampHoverWeight(null, isDarkMode);
};

const parseRgb = (value: string | null | undefined): RgbColor | null => {
	if (!value) { return null; }
	const hex = value.trim().replace('#', '');
	if (/^[0-9a-f]{3}$/i.test(hex)) {
		const r = parseInt(hex[0] + hex[0], 16);
		const g = parseInt(hex[1] + hex[1], 16);
		const b = parseInt(hex[2] + hex[2], 16);
		return { r, g, b };
	}
	if (/^[0-9a-f]{6}$/i.test(hex)) {
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);
		return { r, g, b };
	}
	const numeric = value.match(/[\d.]+/g);
	if (numeric && numeric.length >= 3) {
		const [r, g, b] = numeric.map((n) => Number(n));
		if ([r, g, b].every((v) => Number.isFinite(v))) { return { r, g, b }; }
	}
	return null;
};

const rgbToHsl = (rgb: RgbColor): { h: number; s: number; l: number } => {
	const r = rgb.r / 255; const g = rgb.g / 255; const b = rgb.b / 255;
	const max = Math.max(r, g, b); const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) { return { h: 0, s: 0, l }; }
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h /= 6;
	return { h: h * 360, s, l };
};

const toRgbString = (color: RgbColor): string => `rgb(${color.r}, ${color.g}, ${color.b})`;

const toHexString = (color: RgbColor): string => {
	const toHex = (channel: number) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');
	return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
};

const hslToRgb = (hsl: { h: number; s: number; l: number }): RgbColor => {
	const h = ((hsl.h % 360) + 360) % 360 / 360;
	const s = clamp(hsl.s, 0, 1);
	const l = clamp(hsl.l, 0, 1);
	if (s === 0) {
		const grey = Math.round(l * 255);
		return { r: grey, g: grey, b: grey };
	}
	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const r = hue2rgb(p, q, h + 1 / 3);
	const g = hue2rgb(p, q, h);
	const b = hue2rgb(p, q, h - 1 / 3);
	return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
};

const normalizeColorInput = (value: string | null | undefined): string | null => {
	const parsed = parseRgb(value);
	if (!parsed) { return null; }
	const rounded: RgbColor = {
		r: Math.max(0, Math.min(255, Math.round(parsed.r))),
		g: Math.max(0, Math.min(255, Math.round(parsed.g))),
		b: Math.max(0, Math.min(255, Math.round(parsed.b)))
	};
	return toRgbString(rounded);
};

const adjustLightness = (color: RgbColor, delta: number): RgbColor => {
	const hsl = rgbToHsl(color);
	const next = { h: hsl.h, s: hsl.s, l: clamp(hsl.l + delta, 0, 1) };
	return hslToRgb(next);
};

const resolveColorOrFallback = (value: string | null | undefined, fallback: string): RgbColor => {
	const normalized = normalizeColorInput(value);
	const parsed = parseRgb(normalized);
	if (parsed) { return parsed; }
	const fallbackParsed = parseRgb(fallback);
	if (fallbackParsed) { return fallbackParsed; }
	return { r: 0, g: 0, b: 0 };
};

const mixColors = (base: RgbColor, overlay: RgbColor, overlayWeight: number): RgbColor => {
	const weight = clamp(overlayWeight, 0, 1);
	const baseWeight = 1 - weight;
	return {
		r: Math.round(base.r * baseWeight + overlay.r * weight),
		g: Math.round(base.g * baseWeight + overlay.g * weight),
		b: Math.round(base.b * baseWeight + overlay.b * weight)
	};
};

const resolveHoverColor = (options: { hoverValue: string; base: RgbColor; accent: RgbColor; isDarkMode: boolean }): RgbColor => {
	const { hoverValue, base, accent, isDarkMode } = options;
	const normalized = normalizeColorInput(hoverValue);
	const parsed = parseRgb(normalized);
	const overlayWeight = resolveHoverOverlayWeight(hoverValue, isDarkMode);
	if (parsed) {
		return mixColors(base, parsed, overlayWeight);
	}
	return mixColors(base, accent, overlayWeight);
};

const applyGridThemePalette = (options: { container: HTMLElement; docStyles: CSSStyleDeclaration | null; isDarkMode: boolean }): void => {
	const { container, docStyles, isDarkMode } = options;
	const background = resolveColorOrFallback(docStyles?.getPropertyValue('--background-primary'), isDarkMode ? '#1f1f1f' : '#ffffff');
	const foreground = resolveColorOrFallback(docStyles?.getPropertyValue('--text-normal'), isDarkMode ? '#dadada' : '#2e3338');
	const accent = resolveColorOrFallback(docStyles?.getPropertyValue('--interactive-accent'), '#6aa5ff');
	const hover = resolveHoverColor({
		hoverValue: docStyles?.getPropertyValue('--background-modifier-hover')?.trim() ?? '',
		base: background,
		accent,
		isDarkMode
	});
	const headerSurface = mixColors(background, foreground, 0.04);
	const raisedSurface = mixColors(background, foreground, 0.06);
	const selectedRow = adjustLightness(background, isDarkMode ? 0.12 : -0.06);

	container.style.setProperty('--tlb-grid-surface-resolved', toRgbString(background));
	container.style.setProperty('--tlb-grid-foreground-resolved', toRgbString(foreground));
	container.style.setProperty('--tlb-grid-accent-resolved', toRgbString(accent));
	container.style.setProperty('--tlb-grid-surface-strong-resolved', toRgbString(headerSurface));
	container.style.setProperty('--tlb-grid-surface-raised-resolved', toRgbString(raisedSurface));
	container.style.setProperty('--tlb-grid-row-hover-resolved', toRgbString(hover));
	container.style.setProperty('--tlb-grid-selected-row-resolved', toRgbString(selectedRow));
};

export const computeRecommendedStripeColor = (primaryColor: string, isDarkMode: boolean): string => {
	const primaryRgb = parseRgb(primaryColor);
	const primaryHsl = primaryRgb ? rgbToHsl(primaryRgb) : { h: 0, s: 0, l: isDarkMode ? 0.2 : 0.8 };
	const baseLightness = clamp(primaryHsl.l, 0, 1);
	const lightnessDelta = isDarkMode ? 0.04 : -0.04;
	const targetLightness = clamp(baseLightness + lightnessDelta, 0, 1);
	const h = primaryHsl.h / 360;
	const s = primaryHsl.s;
	const l = targetLightness;
	if (s === 0) {
		const grey = Math.round(l * 255);
		return toHexString({ r: grey, g: grey, b: grey });
	}
	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const r = hue2rgb(p, q, h + 1 / 3);
	const g = hue2rgb(p, q, h);
	const b = hue2rgb(p, q, h - 1 / 3);
	return toHexString({ r: r * 255, g: g * 255, b: b * 255 });
};

const buildBorderColor = (color: string, contrast: number): string => {
	const mix = clamp(contrast, 0, 1);
	if (mix <= 0) {
		return 'transparent';
	}
	if (mix >= 1) {
		return color;
	}
	const mixPercent = (mix * 100).toFixed(2).replace(/\.?0+$/, '');
	const transparentPercent = (100 - Number(mixPercent)).toFixed(2).replace(/\.?0+$/, '');
	return `color-mix(in srgb, transparent ${transparentPercent}%, ${color} ${mixPercent}%)`;
};

export interface StripeStyleOptions {
	container: HTMLElement;
	ownerDocument: Document;
	stripeColorMode: StripeColorMode;
	stripeCustomColor: string | null;
	borderColorMode: BorderColorMode;
	borderCustomColor: string | null;
	borderContrast: number;
	isDarkMode?: boolean;
}

export function applyStripeStyles(options: StripeStyleOptions): void {
	const {
		container,
		ownerDocument,
		borderContrast,
		stripeColorMode,
		stripeCustomColor,
		borderColorMode,
		borderCustomColor
	} = options;
	const isDarkMode = options.isDarkMode ?? ownerDocument.body.classList.contains('theme-dark');
	const docStyles = ownerDocument.defaultView ? ownerDocument.defaultView.getComputedStyle(ownerDocument.body) : null;
	applyGridThemePalette({
		container,
		docStyles,
		isDarkMode
	});
	const primary = docStyles?.getPropertyValue('--background-primary')?.trim() ?? '';
	const primaryColor = primary || '#000000';
	const recommendedStripe = computeRecommendedStripeColor(primaryColor, isDarkMode);
	const normalizedCustomStripe = normalizeColorInput(stripeCustomColor);

	let stripeColor = recommendedStripe;
	let stripeEnabled = true;
	if (stripeColorMode === 'primary') {
		stripeColor = primaryColor;
		stripeEnabled = false;
	} else if (stripeColorMode === 'custom') {
		stripeColor = normalizedCustomStripe ?? recommendedStripe;
	}

	const stripeStrength = stripeEnabled ? 1 : 0;
	container.style.setProperty('--tlb-row-stripe-strength', String(stripeStrength));
	container.style.setProperty('--tlb-odd-row-base', stripeColor);
	container.style.setProperty('--ag-odd-row-background-color', stripeColor, 'important');
	container.style.removeProperty('--tlb-odd-row-override');
	container.classList.remove('tlb-force-odd-row-stripe');
	container.style.setProperty('--tlb-row-stripe-strength-effective', String(stripeStrength));

	const normalizedBorderContrast = clamp(borderContrast, 0, 1);
	container.style.setProperty('--tlb-border-contrast', String(normalizedBorderContrast));
	if (borderColorMode === 'custom') {
		const normalizedCustomBorder = normalizeColorInput(borderCustomColor);
		if (normalizedCustomBorder) {
			const borderColor = buildBorderColor(normalizedCustomBorder, normalizedBorderContrast);
			container.style.setProperty('--ag-border-color', borderColor, 'important');
			container.style.setProperty('--ag-secondary-border-color', borderColor, 'important');
		} else {
			container.style.removeProperty('--ag-border-color');
			container.style.removeProperty('--ag-secondary-border-color');
		}
	} else {
		container.style.removeProperty('--ag-border-color');
		container.style.removeProperty('--ag-secondary-border-color');
	}
}
