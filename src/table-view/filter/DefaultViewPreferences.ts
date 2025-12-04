import { Menu, type App } from 'obsidian';
import { t } from '../../i18n';
import type { DefaultFilterViewPreferences } from '../../types/filterView';
import type { FilterStateStore } from './FilterStateStore';
import { FilterViewEditorModal, type FilterViewEditorResult } from './FilterViewModals';

interface DefaultViewMenuOptions {
	app: App;
	stateStore: FilterStateStore;
	anchor: HTMLElement;
	event?: MouseEvent;
	onEdit: () => Promise<void> | void;
	onReset: () => Promise<void> | void;
}

export function sanitizeIconId(icon: string | null | undefined): string | null {
	if (typeof icon !== 'string') {
		return null;
	}
	const trimmed = icon.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeDefaultViewName(name: string | null | undefined): string | null {
	if (typeof name !== 'string') {
		return null;
	}
	const trimmed = name.trim();
	if (!trimmed) {
		return null;
	}
	const fallback = t('filterViewBar.allTabLabel').trim();
	return trimmed === fallback ? null : trimmed;
}

export function hasCustomDefaultView(stateStore: FilterStateStore): boolean {
	const prefs = stateStore.getState().metadata?.defaultView;
	if (!prefs) {
		return false;
	}
	const name = typeof prefs.name === 'string' ? prefs.name.trim() : '';
	const icon = typeof prefs.icon === 'string' ? prefs.icon.trim() : '';
	return name.length > 0 || icon.length > 0;
}

export function resetDefaultViewPreferences(stateStore: FilterStateStore): boolean {
	let changed = false;
	stateStore.updateState((state) => {
		if (!state.metadata || !state.metadata.defaultView) {
			return;
		}
		state.metadata.defaultView = null;
		changed = true;
	});
	return changed;
}

export async function promptEditDefaultView(app: App, stateStore: FilterStateStore): Promise<boolean> {
	const metadata = stateStore.getState().metadata;
	const currentPrefs = metadata?.defaultView ?? null;
	const fallbackLabel = t('filterViewBar.allTabLabel');
	let changed = false;

	await new Promise<void>((resolve) => {
		const modal = new FilterViewEditorModal(app, {
			title: t('filterViewController.editDefaultModalTitle'),
			columns: [],
			initialName: currentPrefs?.name ?? fallbackLabel,
			initialIcon: currentPrefs?.icon ?? null,
			allowFilterEditing: false,
			allowSortEditing: false,
			onSubmit: (result: FilterViewEditorResult) => {
				const sanitizedName = sanitizeDefaultViewName(result.name);
				const sanitizedIcon = sanitizeIconId(result.icon);
				stateStore.updateState((state) => {
					if (!state.metadata) {
						state.metadata = {};
					}
					const nextPrefs: DefaultFilterViewPreferences = {};
					if (sanitizedName) {
						nextPrefs.name = sanitizedName;
					}
					if (sanitizedIcon) {
						nextPrefs.icon = sanitizedIcon;
					}
					const isEmpty = Object.keys(nextPrefs).length === 0;
					const previous = state.metadata.defaultView ?? null;
					const nameChanged = (previous?.name ?? null) !== (nextPrefs.name ?? null);
					const iconChanged = (previous?.icon ?? null) !== (nextPrefs.icon ?? null);
					state.metadata.defaultView = isEmpty ? null : nextPrefs;
					changed = nameChanged || iconChanged;
				});
				resolve();
			},
			onCancel: () => {
				resolve();
			}
		});
		modal.open();
	});

	return changed;
}

export function openDefaultViewMenu(options: DefaultViewMenuOptions): void {
	const menu = new Menu();
	menu.addItem((item) => {
		item
			.setTitle(t('filterViewController.menuEditDefault'))
			.setIcon('pencil')
			.onClick(() => {
				void options.onEdit();
			});
	});

	if (hasCustomDefaultView(options.stateStore)) {
		menu.addItem((item) => {
			item
				.setTitle(t('filterViewController.menuResetDefault'))
				.setIcon('rotate-ccw')
				.onClick(() => {
					void options.onReset();
				});
		});
	}

	const ownerDoc = options.anchor.ownerDocument ?? document;
	const win = ownerDoc.defaultView ?? window;
	const rect = options.anchor.getBoundingClientRect();
	const x = options.event ? options.event.pageX : rect.left + win.scrollX + rect.width / 2;
	const y = options.event ? options.event.pageY : rect.bottom + win.scrollY;

	menu.showAtPosition({ x, y });
}
