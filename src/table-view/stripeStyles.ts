type RgbColor = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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

const computeStripeBase = (primaryColor: string, stripeStrength: number, isDarkMode: boolean): string => {
	const primaryRgb = parseRgb(primaryColor);
	const primaryHsl = primaryRgb ? rgbToHsl(primaryRgb) : { h: 0, s: 0, l: isDarkMode ? 0.2 : 0.8 };
	const baseLightness = clamp(primaryHsl.l, 0, 1);
	const targetLightness = clamp(baseLightness + (stripeStrength - 0.5), 0, 1);
	return `hsl(${primaryHsl.h.toFixed(1)}deg, ${(primaryHsl.s * 100).toFixed(1)}%, ${(targetLightness * 100).toFixed(1)}%)`;
};

export interface StripeStyleOptions {
	container: HTMLElement;
	ownerDocument: Document;
	stripeStrength: number;
	borderContrast: number;
	isDarkMode?: boolean;
}

export function applyStripeStyles(options: StripeStyleOptions): void {
	const { container, ownerDocument, borderContrast } = options;
	const stripeStrength = clamp(options.stripeStrength, 0, 1);
	const isDarkMode = options.isDarkMode ?? ownerDocument.body.classList.contains('theme-dark');
	const docStyles = ownerDocument.defaultView ? ownerDocument.defaultView.getComputedStyle(ownerDocument.body) : null;
	const primary = docStyles?.getPropertyValue('--background-primary')?.trim() ?? '';
	const primaryColor = primary || 'var(--background-primary)';
	const stripeBase = computeStripeBase(primaryColor, stripeStrength, isDarkMode);
	const effectiveStripeStrength = container.classList.contains('tlb-force-odd-row-stripe')
		? Math.max(stripeStrength, 0.6)
		: stripeStrength;

	container.style.setProperty('--tlb-row-stripe-strength', String(stripeStrength));
	container.style.setProperty('--tlb-border-contrast', String(borderContrast));
	container.style.setProperty('--tlb-odd-row-base', stripeBase);
	container.style.setProperty('--ag-odd-row-background-color', stripeBase, 'important');
	container.style.removeProperty('--tlb-odd-row-override');
	container.classList.remove('tlb-force-odd-row-stripe');
	container.style.setProperty('--tlb-row-stripe-strength-effective', String(effectiveStripeStrength));
}
