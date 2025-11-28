export type StripeColorMode = 'primary' | 'recommended' | 'custom';

export type BorderColorMode = 'recommended' | 'custom';

export interface StripeColorPreference {
	mode: StripeColorMode;
	customColor: string | null;
}

export interface BorderColorPreference {
	mode: BorderColorMode;
	customColor: string | null;
}
