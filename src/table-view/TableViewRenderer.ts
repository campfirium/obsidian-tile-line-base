import type { TableView } from '../TableView';
import { getLogger } from '../utils/logger';
import { syncTagGroupState } from './TableViewFilterPresenter';
import { syncGalleryTagGroupState } from './gallery/galleryFilterPresenter';
import { t } from '../i18n';
import { getPluginContext } from '../pluginContext';
import type { GalleryFilterBar } from './gallery/GalleryFilterBar';
import { renderKanbanView } from './kanban/renderKanbanView';
import { sanitizeKanbanHeightMode } from './kanban/kanbanHeight';
import { sanitizeKanbanFontScale } from '../types/kanban';
import { renderKanbanToolbar } from './kanban/renderKanbanToolbar';
import { renderSlideMode } from './slide/renderSlideMode';
import { renderGalleryMode } from './gallery/renderGalleryMode';
import { renderGridMode } from './renderGridMode';
import { normalizeSlideViewConfig } from '../types/slide';
import { isSlideTemplateEmpty } from './slide/slideDefaults';
import { deserializeColumnConfigs, mergeColumnConfigs } from './columnConfigUtils';
import { extractFrontmatter } from './MarkdownFrontmatter';

	const logger = getLogger('table-view:renderer');
	export async function renderTableView(view: TableView): Promise<void> {
		const rootEl = view.containerEl;
		rootEl.classList.add('tile-line-base-view');
		const container = rootEl.children[1] as HTMLElement | undefined;
		if (!container) { return; }
		container.empty();
		container.classList.add('tlb-table-view-content');
		container.classList.remove('tlb-has-grid');
	container.classList.remove('tlb-kanban-mode');
	container.classList.remove('tlb-slide-mode');
	container.classList.remove('tlb-gallery-mode');

		if (view.gridAdapter) { view.gridController.destroy(); view.gridAdapter = null; view.tableContainer = null; }
		if (view.kanbanController) { view.kanbanController.destroy(); view.kanbanController = null; }
		if (view.slideController) { view.slideController.destroy(); view.slideController = null; }
		if (view.galleryController) { view.galleryController.destroy(); view.galleryController = null; }
		if (view.galleryFilterBar) { view.galleryFilterBar.destroy(); view.galleryFilterBar = null; }
		if (view.galleryQuickFilterController) view.galleryQuickFilterController.cleanup();
		const ownerDoc = container.ownerDocument;
		logger.debug('render start', { file: view.file?.path, containerTag: container.tagName, containerClass: container.className });
		if (!view.file) { container.createDiv({ text: t('tableViewRenderer.noFile') }); return; }
		view.historyManager.reset();
		view.columnLayoutStore.reset(view.file.path);
		view.configManager.reset();
		view.filterStateStore.setFilePath(view.file.path);
		view.filterStateStore.resetState();
		view.tagGroupStore.setFilePath(view.file.path);
		view.tagGroupStore.resetState();
		syncTagGroupState(view);
		view.galleryFilterStateStore.setFilePath(view.file.path);
		view.galleryFilterStateStore.resetState();
		view.galleryTagGroupStore.setFilePath(view.file.path);
		view.galleryTagGroupStore.resetState();
		view.copyTemplate = null;
		const content = await view.app.vault.read(view.file);
		view.captureConversionBaseline(content);
		const parsedFrontmatter = extractFrontmatter(content);
		const configBlock = await view.persistenceService.loadConfig();
		const plugin = getPluginContext();
		view.pendingKanbanBoardState = configBlock?.kanbanBoards ?? null;
		if (configBlock) {
			if (configBlock.filterViews) {
				view.filterStateStore.setState(configBlock.filterViews);
			}
		if (configBlock.tagGroups) {
			view.tagGroupStore.setState(configBlock.tagGroups);
		}
		if ((configBlock as any).galleryFilterViews) {
			view.galleryFilterStateStore.setState((configBlock as any).galleryFilterViews);
		}
		if ((configBlock as any).galleryTagGroups) {
			view.galleryTagGroupStore.setState((configBlock as any).galleryTagGroups);
		}
		if (configBlock.columnWidths) {
			view.columnLayoutStore.applyConfig(configBlock.columnWidths);
		}
		if (typeof configBlock.copyTemplate === 'string') {
			const loadedTemplate = configBlock.copyTemplate.replace(/\r\n/g, '\n');
			view.copyTemplate = loadedTemplate.trim().length > 0 ? loadedTemplate : null;
		}
	}

	if (!view.slidePreferencesLoaded) {
		const globalSlideConfig = plugin?.getDefaultSlideConfig?.() ?? null;
		const preferredConfig = configBlock?.slide ?? globalSlideConfig ?? view.slideConfig;
		const normalized = normalizeSlideViewConfig(preferredConfig ?? null);
		const templateEmpty = isSlideTemplateEmpty(normalized.template);
		view.slideConfig = normalized;
		const hasFileScopedSlideConfig = Boolean(configBlock?.slide);
		view.shouldAutoFillSlideDefaults = !hasFileScopedSlideConfig || templateEmpty;
		view.slideTemplateTouched = Boolean(hasFileScopedSlideConfig && !templateEmpty);
			view.slidePreferencesLoaded = true;
		}
		if (!view.galleryPreferencesLoaded) {
			const globalGalleryConfig = plugin?.getDefaultGalleryConfig?.() ?? null;
			const galleryViewsState = configBlock?.galleryViews;
			const hasGalleryViews = galleryViewsState && Array.isArray(galleryViewsState.views) && galleryViewsState.views.length > 0;
			if (hasGalleryViews) {
				view.galleryViewStore.load({
					views: galleryViewsState.views.map((entry: { id?: string; name?: string; template?: unknown; cardWidth?: unknown; cardHeight?: unknown }) => ({
						...entry,
						template: normalizeSlideViewConfig(entry.template ?? null),
						cardWidth: typeof entry.cardWidth === 'number' ? entry.cardWidth : undefined,
						cardHeight: typeof entry.cardHeight === 'number' ? entry.cardHeight : undefined,
						groupField: typeof (entry as { groupField?: unknown }).groupField === 'string'
							? ((entry as { groupField: string }).groupField.trim() || undefined)
							: undefined
					})),
					activeViewId: galleryViewsState.activeViewId ?? null
				});
				const activeGallery = view.galleryViewStore.ensureActive();
				const normalizedGallery = normalizeSlideViewConfig(activeGallery?.template ?? null);
				const galleryTemplateEmpty = isSlideTemplateEmpty(normalizedGallery.template);
				view.galleryConfig = normalizedGallery;
				view.activeGalleryViewId = activeGallery?.id ?? null;
			view.shouldAutoFillGalleryDefaults = false;
			view.galleryTemplateTouched = !galleryTemplateEmpty;
			view.galleryPreferencesLoaded = true;
			view.galleryViewsLoaded = true;
		} else {
			const preferredGalleryConfig = configBlock?.gallery ?? globalGalleryConfig ?? view.galleryConfig;
			const normalizedGallery = normalizeSlideViewConfig(preferredGalleryConfig ?? null);
			const galleryTemplateEmpty = isSlideTemplateEmpty(normalizedGallery.template);
			const hasFileScopedGalleryConfig = Boolean(configBlock?.gallery);
			view.galleryConfig = normalizedGallery;
			view.galleryViewStore.resetWithConfig(normalizedGallery);
			view.activeGalleryViewId = view.galleryViewStore.getActive()?.id ?? null;
			view.shouldAutoFillGalleryDefaults = !hasFileScopedGalleryConfig || galleryTemplateEmpty;
			view.galleryTemplateTouched = Boolean(hasFileScopedGalleryConfig && !galleryTemplateEmpty);
			view.galleryPreferencesLoaded = true;
			view.galleryViewsLoaded = true;
		}
	}

	if (!view.kanbanPreferencesLoaded) {
		const preference = configBlock?.viewPreference;
		if (preference === 'kanban' || preference === 'table' || preference === 'slide' || preference === 'gallery') view.activeViewMode = preference;
		const kanbanConfig = configBlock?.kanban;
		view.kanbanHeightMode = sanitizeKanbanHeightMode(kanbanConfig?.heightMode);
		view.kanbanMultiRowEnabled = kanbanConfig?.multiRow !== false;
		if (typeof kanbanConfig?.fontScale === 'number') {
			view.kanbanFontScale = sanitizeKanbanFontScale(kanbanConfig.fontScale);
		}
		if (kanbanConfig && typeof kanbanConfig.laneField === 'string') {
			view.kanbanLaneField = kanbanConfig.laneField;
			if (typeof kanbanConfig.sortField === 'string') {
				view.kanbanSortField = kanbanConfig.sortField;
			}
			if (kanbanConfig.sortDirection === 'asc' || kanbanConfig.sortDirection === 'desc') {
				view.kanbanSortDirection = kanbanConfig.sortDirection;
			}
		}
		view.kanbanPreferencesLoaded = true;
	}

	view.filterViewState = view.filterStateStore.getState();
	view.galleryFilterViewState = view.galleryFilterStateStore.getState();
	syncTagGroupState(view);

	const headerColumnConfigs = view.markdownParser.parseHeaderConfig(parsedFrontmatter.body);
	const persistedColumnConfigs = configBlock?.columnConfigs
		? deserializeColumnConfigs(view, configBlock.columnConfigs)
		: null;
	const columnConfigs = mergeColumnConfigs(headerColumnConfigs, persistedColumnConfigs);

	const parsedBlocks = view.markdownParser.parseH2Blocks(parsedFrontmatter.body);
	const hasStructuredBlocks = view.markdownParser.hasStructuredH2Blocks(parsedBlocks);
	if (!hasStructuredBlocks) {
		if (view.file) {
			view.magicMigrationController?.handleNonStandardFile({ container, content, file: view.file });
		} else {
			container.createDiv({ text: t('tableViewRenderer.missingH2'), cls: 'tlb-warning' });
		}
		return;
	}

	view.blocks = parsedBlocks;

	const schemaResult = view.schemaBuilder.buildSchema(view.blocks, columnConfigs ?? null);
	view.dataStore.initialise(schemaResult, columnConfigs ?? null, {
		frontmatter: parsedFrontmatter.frontmatter,
		frontmatterPadding: parsedFrontmatter.padding
	});
	view.schema = view.dataStore.getSchema();
	view.hiddenSortableFields = view.dataStore.getHiddenSortableFields();
	const dirtyFlags = view.dataStore.consumeDirtyFlags();
	view.schemaDirty = dirtyFlags.schemaDirty;
	view.sparseCleanupRequired = dirtyFlags.sparseCleanupRequired;

	if (!view.schema) { container.createDiv({ text: t('tableViewRenderer.noSchema') }); return; }
	view.kanbanBoardController?.processPendingLaneFieldRepairs();
	if (view.schemaDirty || view.sparseCleanupRequired) {
		view.persistenceService.scheduleSave();
		view.schemaDirty = false;
		view.sparseCleanupRequired = false;
	}

	if (!view.filterViewState || view.filterViewState.views.length === 0) {
		view.filterStateStore.loadFromSettings();
		view.filterViewState = view.filterStateStore.getState();
	}
	if (!configBlock || configBlock.tagGroups == null) {
		view.tagGroupStore.loadFromSettings();
	}
	syncTagGroupState(view);
	view.tagGroupController.syncWithAvailableViews();
	syncTagGroupState(view);

	if (!view.galleryFilterViewState || view.galleryFilterViewState.views.length === 0) {
		view.galleryFilterStateStore.loadFromSettings();
		view.galleryFilterViewState = view.galleryFilterStateStore.getState();
	}
	if (!configBlock || (configBlock as any).galleryTagGroups == null) {
		view.galleryTagGroupStore.loadFromSettings();
	}
	syncGalleryTagGroupState(view);
	view.galleryTagGroupController.syncWithAvailableViews();
	syncGalleryTagGroupState(view);

	view.filterOrchestrator.refresh();
	view.galleryFilterOrchestrator.refresh();
	view.initialColumnState = null;
	const primaryField = view.schema.columnNames[0] ?? null;

	const filterViewBar = view.filterViewBar;
	if (filterViewBar) {
		filterViewBar.destroy();
		view.filterViewBar = null;
	}
	const galleryFilterBar = view.galleryFilterBar as GalleryFilterBar | null;
	if (galleryFilterBar) {
		(galleryFilterBar as { destroy: () => void }).destroy();
		view.galleryFilterBar = null;
	}
	if (view.kanbanToolbar) {
		view.kanbanToolbar.destroy();
		view.kanbanToolbar = null;
	}
	if (view.galleryToolbar) {
		view.galleryToolbar.destroy();
		view.galleryToolbar = null;
	}
	if (view.activeViewMode === 'slide') {
		renderSlideMode(view, container);
		return;
	}
	if (view.activeViewMode === 'gallery') {
		renderGalleryMode(view, container);
		return;
	}
	if (view.activeViewMode === 'kanban') {
		renderKanbanToolbar(view, container);
		container.classList.add('tlb-kanban-mode');
		container.classList.remove('tlb-has-grid');
		if ((view.kanbanBoardController?.getBoards().length ?? 0) === 0) {
			view.kanbanBoardController?.ensureBoardForActiveKanbanView();
			container.createDiv({
				cls: 'tlb-kanban-empty',
				text: t('kanbanView.toolbar.noBoardsPlaceholder')
			});
			return;
		}
		if (!view.kanbanLaneField) {
			container.createDiv({
				cls: 'tlb-kanban-warning',
				text: t('kanbanView.laneNotConfigured')
			});
			return;
		}
		const hiddenFields = view.hiddenSortableFields ?? new Set<string>();
		const sortField =
			view.kanbanSortField &&
			(view.schema.columnNames.includes(view.kanbanSortField) || hiddenFields.has(view.kanbanSortField))
				? view.kanbanSortField
				: null;
		renderKanbanView(view, container, {
			primaryField,
			laneField: view.kanbanLaneField,
			laneWidth: view.kanbanLaneWidth,
			fontScale: view.kanbanFontScale,
			sortField,
			heightMode: view.kanbanHeightMode,
			multiRowEnabled: view.kanbanMultiRowEnabled,
			initialVisibleCount: view.kanbanInitialVisibleCount,
			content: view.kanbanCardContentConfig,
			lanePresets: Array.isArray(view.kanbanLanePresets) ? view.kanbanLanePresets : [],
			laneOrder: Array.isArray(view.kanbanLaneOrder) ? view.kanbanLaneOrder : []
		});
		view.filterOrchestrator.applyActiveView();
		return;
	}
	container.classList.add('tlb-has-grid');
	renderGridMode({ view, container, ownerDoc, primaryField, plugin });
}
