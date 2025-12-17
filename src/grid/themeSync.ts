const QUARTZ_THEME_CLASSES = ['ag-theme-quartz', 'ag-theme-quartz-dark', 'ag-theme-quartz-auto-dark'];

const POPUP_THEME_VARS = [
	'--ag-background-color',
	'--ag-foreground-color',
	'--ag-border-color',
	'--ag-popup-shadow',
	'--ag-wrapper-border-radius',
	'--ag-active-color',
	'--ag-input-focus-border-color',
	'--ag-input-focus-box-shadow',
	'--ag-selected-row-background-color',
	'--background-primary',
	'--background-secondary',
	'--text-normal',
	'--text-on-accent'
];

interface SyncThemeOptions {
	ownerDocument?: Document | null;
	isDarkMode?: boolean;
}

export function syncGridContainerTheme(container: HTMLElement, options?: SyncThemeOptions): { isDarkMode: boolean; themeClass: string } {
	const ownerDocument = options?.ownerDocument ?? container.ownerDocument ?? document;
	const isDarkMode = typeof options?.isDarkMode === 'boolean'
		? options.isDarkMode
		: ownerDocument.body.classList.contains('theme-dark');
	const targetTheme = isDarkMode ? 'ag-theme-quartz-dark' : 'ag-theme-quartz';
	const agThemes = Array.from(container.classList).filter(cls => cls.startsWith('ag-theme'));
	const hasQuartzTheme = agThemes.some(cls => QUARTZ_THEME_CLASSES.includes(cls));

	if (hasQuartzTheme || agThemes.length === 0) {
		container.classList.remove(...QUARTZ_THEME_CLASSES);
		container.classList.add(targetTheme);
	}

	return { isDarkMode, themeClass: targetTheme };
}

const getOrCreatePopupRoot = (doc: Document): HTMLElement => {
	const className = 'tlb-grid-popup-root';
	const existing = doc.body.querySelector<HTMLElement>(`.${className}`);
	if (existing) {
		return existing;
	}
	const el = doc.createElement('div');
	el.classList.add(className);
	doc.body.appendChild(el);
	return el;
};

export function syncGridPopupRoot(container: HTMLElement, options?: SyncThemeOptions): HTMLElement {
	const ownerDocument = options?.ownerDocument ?? container.ownerDocument ?? document;
	const isDarkMode = typeof options?.isDarkMode === 'boolean'
		? options.isDarkMode
		: ownerDocument.body.classList.contains('theme-dark');
	const root = getOrCreatePopupRoot(ownerDocument);

	root.classList.remove('theme-dark', 'theme-light');
	root.classList.forEach(cls => {
		if (cls.startsWith('ag-theme')) {
			root.classList.remove(cls);
		}
	});
	root.classList.add(isDarkMode ? 'theme-dark' : 'theme-light');

	const containerThemes = Array.from(container.classList).filter(cls => cls.startsWith('ag-theme'));
	const themesToApply = containerThemes.length > 0 ? containerThemes : [isDarkMode ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'];
	root.classList.add(...themesToApply);

	const computed = ownerDocument.defaultView ? ownerDocument.defaultView.getComputedStyle(container) : null;
	for (const key of POPUP_THEME_VARS) {
		const value = computed?.getPropertyValue(key);
		if (value) {
			root.style.setProperty(key, value.trim());
		}
	}

	return root;
}
