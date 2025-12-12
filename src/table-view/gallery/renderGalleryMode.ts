import { Menu, Notice } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { TableView } from '../../TableView';
import { GalleryViewController } from './GalleryViewController';
import { SlideTemplateModal } from '../slide/SlideTemplateModal';
import { ensureLayoutDefaults } from '../slide/slideConfigHelpers';
import { buildBuiltInGalleryTemplate, mergeSlideTemplateFields } from '../slide/slideDefaults';
import { normalizeSlideViewConfig } from '../../types/slide';
import { getPluginContext } from '../../pluginContext';
import { getLogger } from '../../utils/logger';
import { renderGalleryFilterControls } from './galleryFilterPresenter';
import { resolveGalleryCardFieldContext } from './galleryCardFieldMenu';

const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 320;
const logger = getLogger('gallery:render-mode');

export function renderGalleryMode(view: TableView, container: HTMLElement): void {
	const normalizeSize = (value: unknown, fallback: number): number => {
		const numeric = typeof value === 'number' ? value : Number(value);
		return Number.isFinite(numeric) && numeric > 40 && numeric < 2000 ? numeric : fallback;
	};
	view.galleryQuickFilterController.cleanup();
	container.classList.add('tlb-gallery-mode');
	const filterContainer = container.createDiv({ cls: 'tlb-gallery-filter-container' });
	const galleryContainer = container.createDiv({ cls: 'tlb-gallery-container' });
	const rows = view.galleryFilterOrchestrator.getVisibleRows();
	const fields = view.schema?.columnNames ?? [];
	const columnConfigs = view.schema?.columnConfigs ?? null;
	const sourcePath = view.file?.path ?? view.app.workspace.getActiveFile()?.path ?? '';
	let shouldApplyBuiltIn = view.shouldAutoFillGalleryDefaults;
	const builtInTemplate = buildBuiltInGalleryTemplate(fields, columnConfigs, rows);
	const plugin = getPluginContext();
	const enforceSingleWithImageConfig = (config: ReturnType<typeof normalizeSlideViewConfig>): ReturnType<typeof normalizeSlideViewConfig> => {
		const base = ensureLayoutDefaults(config);
		const unifiedWithImage = base.template.single.withImage;
		return {
			...base,
			template: {
				...base.template,
				mode: 'single' as const,
				single: {
					withImage: unifiedWithImage,
					withoutImage: unifiedWithImage as unknown as typeof base.template.single.withoutImage
				},
				split: base.template.split
			}
		};
	};

	const hydrateConfig = (config: ReturnType<typeof normalizeSlideViewConfig>) => {
		const base = normalizeSlideViewConfig(config);
		const template = shouldApplyBuiltIn
			? mergeSlideTemplateFields(base.template, builtInTemplate)
			: base.template;
		const merged = normalizeSlideViewConfig({ ...base, template });
		return enforceSingleWithImageConfig(ensureLayoutDefaults(merged));
	};

	const ensureActiveGalleryConfig = (targetId?: string) => {
		const activeDef = targetId ? view.galleryViewStore.setActive(targetId) : view.galleryViewStore.ensureActive();
		const resolved = activeDef ?? view.galleryViewStore.createView({ template: view.galleryConfig, setActive: true });
		const enforced = hydrateConfig(resolved.template);
		const cardWidth = normalizeSize(resolved.cardWidth, DEFAULT_CARD_WIDTH);
		const cardHeight = normalizeSize(resolved.cardHeight, DEFAULT_CARD_HEIGHT);
		view.galleryConfig = enforced;
		view.activeGalleryViewId = resolved.id;
		view.galleryViewStore.updateTemplate(resolved.id, enforced);
		view.galleryViewStore.updateCardSize(resolved.id, { width: cardWidth, height: cardHeight });
		view.galleryTemplateTouched = view.galleryTemplateTouched || shouldApplyBuiltIn;
		view.shouldAutoFillGalleryDefaults = false;
		shouldApplyBuiltIn = false;
		return { def: resolved, config: enforced, cardWidth, cardHeight };
	};

	const openTemplateModal = (viewId?: string) => {
		const active = ensureActiveGalleryConfig(viewId ?? view.activeGalleryViewId ?? undefined);
		const modal = new SlideTemplateModal({
			app: view.app,
			fields,
			fieldConfigs: columnConfigs,
			sampleRows: rows,
			initial: active.config.template,
			titleKey: 'galleryView.templateModal.title' as TranslationKey,
			allowedModes: ['single'],
			allowedSingleBranches: ['withImage'],
			enableImageTypography: false,
			cardSize: { width: active.cardWidth, height: active.cardHeight },
			renderIntroSection: undefined,
			buildBuiltInTemplate: (templateFields, templateConfigs, templateRows) =>
				buildBuiltInGalleryTemplate(templateFields, templateConfigs, templateRows),
			onCardSizeChange: (size) => {
				const width = normalizeSize(size.width, DEFAULT_CARD_WIDTH);
				const height = normalizeSize(size.height, DEFAULT_CARD_HEIGHT);
				view.galleryViewStore.updateCardSize(active.def.id, { width, height });
				view.galleryController?.setCardSize({ width, height });
				view.markUserMutation('gallery-template');
				view.persistenceService.scheduleSave();
			},
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
			},
			onSaveDefault: plugin
				? async (nextTemplate, cardSize) => {
					try {
						const enforced = enforceSingleWithImageConfig(
							normalizeSlideViewConfig({ ...active.config, template: nextTemplate })
						);
						const width = normalizeSize(cardSize?.width ?? active.cardWidth, DEFAULT_CARD_WIDTH);
						const height = normalizeSize(cardSize?.height ?? active.cardHeight, DEFAULT_CARD_HEIGHT);
						await plugin.setDefaultGalleryConfig(enforced, { width, height });
						new Notice(t('slideView.templateModal.setDefaultSuccess'));
					} catch (error) {
						logger.error('Failed to set gallery template as default', error);
						new Notice(t('slideView.templateModal.setDefaultError'));
					}
				}
				: undefined,
			getGlobalDefault: () => {
				const globalConfig = plugin?.getDefaultGalleryConfig?.() ?? null;
				const globalCardSize = plugin?.getDefaultGalleryCardSize?.() ?? null;
				if (!globalConfig && !globalCardSize) {
					return null;
				}
				const enforced = enforceSingleWithImageConfig(normalizeSlideViewConfig(globalConfig ?? null));
				return {
					template: enforced.template,
					cardWidth: globalCardSize?.width ?? undefined,
					cardHeight: globalCardSize?.height ?? undefined
				};
			}
		});
		modal.open();
	};

	const selectGalleryView = (viewId: string) => {
		const next = ensureActiveGalleryConfig(viewId);
		view.galleryController?.updateConfig(next.config);
		view.galleryController?.setCardSize({ width: next.cardWidth, height: next.cardHeight });
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
	};

	const createGalleryView = () => {
		const baseTemplate = view.galleryConfig ?? normalizeSlideViewConfig(null);
		const next = view.galleryViewStore.createView({ template: baseTemplate, setActive: true });
		const enforced = ensureActiveGalleryConfig(next.id);
		view.galleryController?.updateConfig(enforced.config);
		view.galleryController?.setCardSize({ width: enforced.cardWidth, height: enforced.cardHeight });
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
	};

	const duplicateGalleryView = (viewId: string) => {
		const duplicated = view.galleryViewStore.duplicateView(viewId);
		if (!duplicated) return;
		const enforced = ensureActiveGalleryConfig(duplicated.id);
		view.galleryController?.updateConfig(enforced.config);
		view.galleryController?.setCardSize({ width: enforced.cardWidth, height: enforced.cardHeight });
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
	};

	const deleteGalleryView = (viewId: string) => {
		if (view.galleryViewStore.getState().views.length <= 1) {
			new Notice(t('galleryView.toolbar.cannotDeleteLastGallery'));
			return;
		}
		view.galleryViewStore.deleteView(viewId);
		const active = ensureActiveGalleryConfig();
		view.galleryController?.updateConfig(active.config);
		view.galleryController?.setCardSize({ width: active.cardWidth, height: active.cardHeight });
		view.markUserMutation('gallery-template');
		view.persistenceService.scheduleSave();
	};

	const { config: activeConfig, cardWidth: activeCardWidth, cardHeight: activeCardHeight } = ensureActiveGalleryConfig();

	const controller = new GalleryViewController({
		app: view.app,
		container: galleryContainer,
		rows,
		fields,
		config: activeConfig,
		cardWidth: activeCardWidth,
		cardHeight: activeCardHeight,
		sourcePath,
		quickFilterManager: view.galleryQuickFilterManager,
		subscribeToRows: (listener) => view.galleryFilterOrchestrator.addVisibleRowsListener(listener),
		getCardFieldMenu: () =>
			resolveGalleryCardFieldContext({
				activeGroup: view.galleryTagGroupStore.getActiveGroup(),
				filterViews: view.galleryFilterViewState?.views ?? []
			}),
		onSaveRow: async (row, values) => {
			const rowIndex = view.dataStore.getBlockIndexFromRow(row);
			if (rowIndex == null) return;
			for (const [field, value] of Object.entries(values)) {
				view.dataStore.updateCell(rowIndex, field, value);
			}
			view.markUserMutation('gallery-inline-edit');
			view.persistenceService.scheduleSave();
			view.filterOrchestrator.refresh();
			view.galleryFilterOrchestrator.refresh();
			return view.galleryFilterOrchestrator.getVisibleRows();
		},
		onTemplateChange: () => {
			view.galleryTemplateTouched = true;
			view.shouldAutoFillGalleryDefaults = false;
			view.markUserMutation('gallery-template');
			view.persistenceService.scheduleSave();
		}
	});

	view.galleryController = controller;
	renderGalleryFilterControls(view, filterContainer, {
		onDefaultViewMenu: () => {
			const activeId = view.activeGalleryViewId ?? view.galleryViewStore.getState().activeViewId ?? undefined;
			openTemplateModal(activeId);
		},
		onEditDefaultView: () => {
			const activeId = view.activeGalleryViewId ?? view.galleryViewStore.getState().activeViewId ?? undefined;
			openTemplateModal(activeId);
		},
		onOpenSettings: (_button, event) => {
			event.preventDefault();
			const menu = new Menu();
			const state = view.galleryViewStore.getState();
			const activeId = view.activeGalleryViewId ?? state.activeViewId ?? null;
			for (const entry of state.views) {
				menu.addItem((item) => {
					const label = entry.name || t('galleryView.toolbar.unnamedGalleryLabel');
					item.setTitle(entry.id === activeId ? `✓ ${label}` : label).onClick(() => {
						selectGalleryView(entry.id);
					});
				});
			}
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('galleryView.toolbar.addGalleryButtonAriaLabel')).onClick(() => {
					createGalleryView();
				});
			});
			if (activeId) {
				menu.addItem((item) => {
					item.setTitle(t('galleryView.toolbar.editGalleryLabel')).onClick(() => openTemplateModal(activeId));
				});
				menu.addItem((item) => {
					item.setTitle(t('galleryView.toolbar.duplicateGalleryLabel')).onClick(() => duplicateGalleryView(activeId));
				});
				menu.addItem((item) => {
					item.setTitle(t('galleryView.toolbar.deleteGalleryLabel')).onClick(() => deleteGalleryView(activeId));
				});
			}
			menu.showAtMouseEvent(event);
		}
	});

	view.galleryFilterOrchestrator.applyActiveView();
	view.filterOrchestrator.applyActiveView();
}
