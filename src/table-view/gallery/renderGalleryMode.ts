import { Menu, Notice } from 'obsidian';
import { t } from '../../i18n';
import type { TableView } from '../../TableView';
import { GalleryToolbar } from './GalleryToolbar';
import { GalleryViewController } from './GalleryViewController';
import { SlideTemplateModal } from '../slide/SlideTemplateModal';
import { ensureLayoutDefaults } from '../slide/slideConfigHelpers';
import { buildBuiltInSlideTemplate, mergeSlideTemplateFields } from '../slide/slideDefaults';
import { normalizeSlideViewConfig } from '../../types/slide';

export function renderGalleryMode(view: TableView, container: HTMLElement): void {
	view.globalQuickFilterController.cleanup();
	container.classList.add('tlb-gallery-mode');
	const toolbarContainer = container.createDiv({ cls: 'tlb-gallery-toolbar-container' });
	const galleryContainer = container.createDiv({ cls: 'tlb-gallery-container' });
	const rows = view.filterOrchestrator.getVisibleRows();
	const fields = view.schema?.columnNames ?? [];
	const sourcePath = view.file?.path ?? view.app.workspace.getActiveFile()?.path ?? '';
	let shouldApplyBuiltIn = view.shouldAutoFillGalleryDefaults;
	const builtInTemplate = buildBuiltInSlideTemplate(fields);
	const enforceSingleWithImageConfig = (config: ReturnType<typeof normalizeSlideViewConfig>): ReturnType<typeof normalizeSlideViewConfig> => {
		const base = ensureLayoutDefaults(config);
		const mergedTemplate = mergeSlideTemplateFields(base.template, builtInTemplate);
		return {
			...base,
			template: {
				...base.template,
				mode: 'single' as const,
				textColor: mergedTemplate.textColor,
				backgroundColor: mergedTemplate.backgroundColor,
				single: {
					withImage: mergedTemplate.single.withImage,
					withoutImage: builtInTemplate.single.withoutImage
				},
				split: builtInTemplate.split
			}
		};
	};

	const hydrateConfig = (config: ReturnType<typeof normalizeSlideViewConfig>) => {
		const base = normalizeSlideViewConfig(config);
		const template = shouldApplyBuiltIn
			? mergeSlideTemplateFields(base.template, builtInTemplate)
			: base.template;
		const merged = normalizeSlideViewConfig({ ...base, template });
		return enforceSingleWithImageConfig(merged);
	};

	const ensureActiveGalleryConfig = (targetId?: string) => {
		const activeDef = targetId ? view.galleryViewStore.setActive(targetId) : view.galleryViewStore.ensureActive();
		const resolved = activeDef ?? view.galleryViewStore.createView({ template: view.galleryConfig, setActive: true });
		const enforced = hydrateConfig(resolved.template);
		view.galleryConfig = enforced;
		view.activeGalleryViewId = resolved.id;
		view.galleryViewStore.updateTemplate(resolved.id, enforced);
		view.galleryTemplateTouched = view.galleryTemplateTouched || shouldApplyBuiltIn;
		view.shouldAutoFillGalleryDefaults = false;
		shouldApplyBuiltIn = false;
		return { def: resolved, config: enforced };
	};

	const refreshToolbarState = () => {
		const state = view.galleryViewStore.getState();
		view.galleryToolbar?.updateState(
			state.views.map((entry) => ({ id: entry.id, name: entry.name })),
			state.activeViewId
		);
		view.galleryToolbar?.setActiveView(view.activeGalleryViewId ?? state.activeViewId ?? null);
	};

	const openTemplateModal = (viewId?: string) => {
		const active = ensureActiveGalleryConfig(viewId ?? view.activeGalleryViewId ?? undefined);
		const modal = new SlideTemplateModal({
			app: view.app,
			fields,
			initial: active.config.template,
			allowedModes: ['single'],
			allowedSingleBranches: ['withImage'],
			onSave: (nextTemplate) => {
				const nextConfig = enforceSingleWithImageConfig(
					normalizeSlideViewConfig({ ...active.config, template: nextTemplate })
				);
				view.galleryTemplateTouched = true;
				view.shouldAutoFillGalleryDefaults = false;
				view.galleryViewStore.updateTemplate(active.def.id, nextConfig);
				view.galleryConfig = nextConfig;
				view.galleryController?.updateConfig(nextConfig);
				view.markUserMutation('gallery-template');
				view.persistenceService.scheduleSave();
			}
		});
		modal.open();
	};

	const selectGalleryView = (viewId: string) => {
		const next = ensureActiveGalleryConfig(viewId);
		view.galleryController?.updateConfig(next.config);
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
		refreshToolbarState();
	};

	const createGalleryView = () => {
		const baseTemplate = view.galleryConfig ?? normalizeSlideViewConfig(null);
		const next = view.galleryViewStore.createView({ template: baseTemplate, setActive: true });
		const enforced = ensureActiveGalleryConfig(next.id).config;
		view.galleryController?.updateConfig(enforced);
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
		refreshToolbarState();
	};

	const duplicateGalleryView = (viewId: string) => {
		const duplicated = view.galleryViewStore.duplicateView(viewId);
		if (!duplicated) return;
		const enforced = ensureActiveGalleryConfig(duplicated.id).config;
		view.galleryController?.updateConfig(enforced);
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
		refreshToolbarState();
	};

	const deleteGalleryView = (viewId: string) => {
		if (view.galleryViewStore.getState().views.length <= 1) {
			new Notice(t('galleryView.toolbar.cannotDeleteLastGallery'));
			return;
		}
		view.galleryViewStore.deleteView(viewId);
		const active = ensureActiveGalleryConfig();
		view.galleryController?.updateConfig(active.config);
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
		refreshToolbarState();
	};

	const { config: activeConfig } = ensureActiveGalleryConfig();

	const controller = new GalleryViewController({
		app: view.app,
		container: galleryContainer,
		rows,
		fields,
		config: activeConfig,
		sourcePath,
		quickFilterManager: view.globalQuickFilterManager,
		subscribeToRows: (listener) => view.filterOrchestrator.addVisibleRowsListener(listener),
		onSaveRow: async (row, values) => {
			const rowIndex = view.dataStore.getBlockIndexFromRow(row);
			if (rowIndex == null) return;
			for (const [field, value] of Object.entries(values)) {
				view.dataStore.updateCell(rowIndex, field, value);
			}
			view.markUserMutation('gallery-inline-edit');
			view.persistenceService.scheduleSave();
			view.filterOrchestrator.refresh();
			return view.filterOrchestrator.getVisibleRows();
		},
		onTemplateChange: () => {
			view.galleryTemplateTouched = true;
			view.shouldAutoFillGalleryDefaults = false;
			view.markUserMutation('gallery-template');
			view.persistenceService.scheduleSave();
		}
	});

	view.galleryController = controller;
	view.galleryToolbar = new GalleryToolbar({
		container: toolbarContainer,
		views: view.galleryViewStore.getState().views,
		activeViewId: view.activeGalleryViewId,
		renderQuickFilter: (searchContainer) => view.globalQuickFilterController.render(searchContainer),
		onSelectView: (viewId) => {
			selectGalleryView(viewId);
		},
		onCreateView: () => {
			createGalleryView();
		},
		onOpenViewMenu: (viewId, event) => {
			event.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle(t('galleryView.toolbar.editGalleryLabel')).onClick(() => {
					openTemplateModal(viewId);
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('galleryView.toolbar.duplicateGalleryLabel')).onClick(() => {
					duplicateGalleryView(viewId);
				});
			});
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('galleryView.toolbar.deleteGalleryLabel')).onClick(() => {
					deleteGalleryView(viewId);
				});
			});
			menu.showAtMouseEvent(event);
		},
		onOpenSettings: (button, event) => {
			event.preventDefault();
			const menu = new Menu();
			const rect = button.getBoundingClientRect();
			const ownerDoc = button.ownerDocument;
			const win = ownerDoc?.defaultView ?? window;
			menu.showAtPosition({
				x: rect.left + win.scrollX,
				y: rect.bottom + win.scrollY
			});
		},
		onEditView: (viewId) => {
			openTemplateModal(viewId);
		}
	});

	refreshToolbarState();

	view.filterOrchestrator.applyActiveView();
}
