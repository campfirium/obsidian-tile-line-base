import { Menu, Notice } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { TableView } from '../../TableView';
import { GalleryViewController } from './GalleryViewController';
import { SlideTemplateModal } from '../slide/SlideTemplateModal';
import { ensureLayoutDefaults } from '../slide/slideConfigHelpers';
import { buildBuiltInSlideTemplate, mergeSlideTemplateFields } from '../slide/slideDefaults';
import { normalizeSlideViewConfig } from '../../types/slide';
import { getPluginContext } from '../../pluginContext';
import { getLogger } from '../../utils/logger';
import { renderGalleryFilterControls, updateGalleryFilterViewBarTagGroupState } from './galleryFilterPresenter';

const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 240;
const logger = getLogger('gallery:render-mode');

export function renderGalleryMode(view: TableView, container: HTMLElement): void {
	const normalizeSize = (value: unknown, fallback: number): number => {
		const numeric = typeof value === 'number' ? value : Number(value);
		return Number.isFinite(numeric) && numeric > 40 && numeric < 2000 ? numeric : fallback;
	};
	const collectUniqueFieldValues = (field: string, limit: number): string[] => {
		const rows = view.dataStore.extractRowData();
		const seen = new Set<string>();
		const result: string[] = [];
		for (const row of rows) {
			const raw = row[field];
			if (raw == null) continue;
			const value = typeof raw === 'string' ? raw : String(raw);
			const trimmed = value.trim();
			if (!trimmed || seen.has(trimmed)) continue;
			seen.add(trimmed);
			result.push(trimmed);
			if (Number.isFinite(limit) && limit > 0 && result.length >= limit) break;
		}
		return result;
	};
	view.galleryQuickFilterController.cleanup();
	container.classList.add('tlb-gallery-mode');
	const filterContainer = container.createDiv({ cls: 'tlb-gallery-filter-container' });
	const galleryContainer = container.createDiv({ cls: 'tlb-gallery-container' });
	const rows = view.galleryFilterOrchestrator.getVisibleRows();
	const fields = view.schema?.columnNames ?? [];
	const sourcePath = view.file?.path ?? view.app.workspace.getActiveFile()?.path ?? '';
	let shouldApplyBuiltIn = view.shouldAutoFillGalleryDefaults;
	const builtInTemplate = buildBuiltInSlideTemplate(fields);
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

	const seedGroupFilters = (groupField: string | null | undefined) => {
		const field = (groupField ?? '').trim();
		if (!field || !view.schema?.columnNames.includes(field)) {
			return;
		}
		const existingIds = new Set((view.galleryFilterViewState?.views ?? []).map((entry) => entry.id));
		const values = collectUniqueFieldValues(field, 50);
		if (values.length === 0) {
			return;
		}
		view.galleryFilterViewController.ensureFilterViewsForFieldValues(field, values);
		const newViews = (view.galleryFilterViewState?.views ?? []).filter(
			(entry) => entry.id && !existingIds.has(entry.id)
		);
		if (newViews.length > 0) {
			const defaultGroupId = view.galleryTagGroupStore.getDefaultGroupId();
			view.galleryTagGroupStore.updateState((state) => {
				const targetId = state.groups.some((group) => group.id === state.activeGroupId)
					? state.activeGroupId ?? defaultGroupId
					: defaultGroupId;
				const target =
					state.groups.find((group) => group.id === targetId) ??
					state.groups.find((group) => group.id === defaultGroupId);
				if (!target) {
					return;
				}
				const seen = new Set(target.viewIds);
				for (const viewDef of newViews) {
					if (!viewDef.id || seen.has(viewDef.id)) {
						continue;
					}
					target.viewIds.push(viewDef.id);
					seen.add(viewDef.id);
				}
			});
		}
		view.galleryTagGroupController?.syncWithAvailableViews();
		updateGalleryFilterViewBarTagGroupState(view);
		view.galleryFilterBar?.render(view.galleryFilterViewState);
		view.galleryFilterOrchestrator.refresh();
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
		seedGroupFilters(resolved.groupField);
		return { def: resolved, config: enforced, cardWidth, cardHeight };
	};

	const openTemplateModal = (viewId?: string) => {
		const active = ensureActiveGalleryConfig(viewId ?? view.activeGalleryViewId ?? undefined);
		let pendingName = active.def.name ?? '';
		const modal = new SlideTemplateModal({
			app: view.app,
			fields,
			initial: active.config.template,
			titleKey: 'galleryView.templateModal.title' as TranslationKey,
			allowedModes: ['single'],
			allowedSingleBranches: ['withImage'],
			cardSize: { width: active.cardWidth, height: active.cardHeight },
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
			const trimmedName = pendingName.trim();
			if (trimmedName.length > 0 && trimmedName !== active.def.name) {
				view.galleryViewStore.updateName(active.def.id, trimmedName);
				view.markUserMutation('gallery-template');
				view.persistenceService.scheduleSave();
			}
			view.galleryTemplateTouched = true;
			view.shouldAutoFillGalleryDefaults = false;
			view.galleryViewStore.updateTemplate(active.def.id, nextConfig);
			view.galleryConfig = nextConfig;
			view.galleryController?.updateConfig(nextConfig);
			view.markUserMutation('gallery-template');
			view.persistenceService.scheduleSave();
		},
			onSaveDefault: plugin
				? async (nextTemplate) => {
					try {
						const enforced = enforceSingleWithImageConfig(
							normalizeSlideViewConfig({ ...active.config, template: nextTemplate })
						);
						await plugin.setDefaultGalleryConfig(enforced);
						new Notice(t('slideView.templateModal.setDefaultSuccess'));
					} catch (error) {
						logger.error('Failed to set gallery template as default', error);
						new Notice(t('slideView.templateModal.setDefaultError'));
					}
				}
				: undefined,
				getGlobalDefault: () => {
					const globalConfig = plugin?.getDefaultGalleryConfig?.() ?? null;
					return globalConfig ? enforceSingleWithImageConfig(normalizeSlideViewConfig(globalConfig)) : null;
				},
				renderExtraSections: (container) => {
					const grouping = container.createDiv({ cls: 'tlb-gallery-template__filters' });
					grouping.createEl('h3', { text: t('galleryView.templateModal.groupFieldTitle' as TranslationKey) });
					const groupRow = grouping.createDiv({ cls: 'tlb-gallery-template__filters-row' });
					const groupLabel = groupRow.createEl('label', { text: t('galleryView.templateModal.groupFieldLabel' as TranslationKey) });
					groupLabel.setAttribute('for', 'tlb-gallery-group-field');
					const groupSelect = groupRow.createEl('select', { attr: { id: 'tlb-gallery-group-field' } });
					const noneOption = groupSelect.createEl('option', {
						text: t('galleryView.templateModal.groupFieldNone' as TranslationKey),
						value: ''
					});
					const uniqueFields = Array.from(new Set(fields));
					for (const field of uniqueFields) {
						groupSelect.createEl('option', { text: field, value: field });
					}
					const currentGroup = active.def.groupField ?? '';
					groupSelect.value = currentGroup || '';
					const applyGroupField = (value: string) => {
						view.galleryViewStore.setGroupField(active.def.id, value || null);
						view.markUserMutation('gallery-template');
						view.persistenceService.scheduleSave();
						seedGroupFilters(value);
					};
					groupSelect.addEventListener('change', (evt) => {
						const value = (evt.target as HTMLSelectElement).value;
						applyGroupField(value);
					});
					if (!currentGroup) {
						noneOption.selected = true;
					}

					const section = container.createDiv({ cls: 'tlb-gallery-template__filters' });
					section.createEl('h3', { text: t('galleryView.templateModal.filterSectionTitle' as TranslationKey) });
					const descEl = section.createDiv({ cls: 'tlb-gallery-template__filters-desc' });
						const pickerRow = section.createDiv({ cls: 'tlb-gallery-template__filters-row' });
						const label = pickerRow.createEl('label', { text: t('galleryView.templateModal.filterPickerLabel' as TranslationKey) });
						label.setAttribute('for', 'tlb-gallery-filter-picker');
						const selectEl = pickerRow.createEl('select', { attr: { id: 'tlb-gallery-filter-picker' } });
						const actions = section.createDiv({ cls: 'tlb-gallery-template__filters-actions' });
						const newBtn = actions.createEl('button', {
							text: t('galleryView.templateModal.newFilterButton' as TranslationKey)
						});
						const editBtn = actions.createEl('button', {
							text: t('galleryView.templateModal.editFilterButton' as TranslationKey),
							cls: 'mod-cta'
						});
						const manageGroupsBtn = actions.createEl('button', {
							text: t('galleryView.templateModal.manageGroupsButton' as TranslationKey)
						});

						const rebuild = () => {
							while (selectEl.firstChild) {
								selectEl.removeChild(selectEl.firstChild);
							}
							const state = view.galleryFilterStateStore.getState();
							const views = Array.isArray(state.views) ? state.views : [];
							const activeViewId = state.activeViewId ?? null;
							const allLabel = t('galleryView.templateModal.filterAllLabel' as TranslationKey);
							const allOption = selectEl.createEl('option', { text: allLabel, value: '' });
							if (!activeViewId) {
								allOption.selected = true;
							}
							for (const entry of views) {
								const option = selectEl.createEl('option', {
									text: (entry.name ?? '').trim() || t('filterViewBar.unnamedViewLabel'),
									value: entry.id
								});
								if (entry.id === activeViewId) {
									option.selected = true;
								}
							}
							const activeFilter = view.galleryFilterStateStore.findActiveView();
							const filterLabel = activeFilter?.name?.trim() || t('filterViewBar.unnamedViewLabel');
							descEl.setText(
								activeFilter
									? t('galleryView.templateModal.filterSectionActive' as TranslationKey, { name: filterLabel })
									: t('galleryView.templateModal.filterSectionEmpty' as TranslationKey)
							);
						};

						selectEl.addEventListener('change', (event) => {
							const value = (event.target as HTMLSelectElement).value;
							view.galleryFilterViewController.activateFilterView(value || null);
							view.galleryFilterOrchestrator.refresh();
							view.markUserMutation('gallery-filter-change');
							view.persistenceService.scheduleSave();
							rebuild();
						});

						newBtn.addEventListener('click', (evt) => {
							evt.preventDefault();
							void view.galleryFilterViewController.promptCreateFilterView().then(() => {
								view.galleryFilterOrchestrator.refresh();
								rebuild();
							});
						});

						editBtn.addEventListener('click', (evt) => {
							evt.preventDefault();
							const current = view.galleryFilterStateStore.findActiveView();
							if (!current) {
								void view.galleryFilterViewController.promptCreateFilterView().then(() => {
									view.galleryFilterOrchestrator.refresh();
									rebuild();
								});
								return;
							}
							void view.galleryFilterViewController.updateFilterView(current.id).then(() => {
								view.galleryFilterOrchestrator.refresh();
								rebuild();
							});
						});

						manageGroupsBtn.addEventListener('click', (evt) => {
							evt.preventDefault();
							view.galleryTagGroupController?.openTagGroupMenu(manageGroupsBtn);
						});

					rebuild();
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
