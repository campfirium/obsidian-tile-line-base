import type { TableView } from '../TableView';
import { clampColumnWidth } from '../grid/columnSizing';
import { getLogger } from '../utils/logger';
import { buildColumnDefinitions, mountGrid } from './GridMountCoordinator';
import { renderFilterViewControls, syncTagGroupState } from './TableViewFilterPresenter';
import { handleColumnResize, handleColumnOrderChange, handleHeaderEditEvent } from './TableViewInteractions';
import { handleStatusChange, handleCellEdit } from './TableCellInteractions';
import { handleCellLinkOpen } from './LinkNavigation';
import { t } from '../i18n';
import { getPluginContext } from '../pluginContext';
import { renderKanbanView } from './kanban/renderKanbanView';
import { sanitizeKanbanHeightMode } from './kanban/kanbanHeight';
/* eslint-disable max-lines */
import { sanitizeKanbanFontScale } from '../types/kanban';
import { renderKanbanToolbar } from './kanban/renderKanbanToolbar';
import { renderSlideMode } from './slide/renderSlideMode';
import { normalizeSlideViewConfig } from '../types/slide';
import { deserializeColumnConfigs, mergeColumnConfigs } from './columnConfigUtils';

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

	if (view.gridAdapter) {
		view.gridController.destroy();
		view.gridAdapter = null;
		view.tableContainer = null;
	}
	if (view.kanbanController) {
		view.kanbanController.destroy();
		view.kanbanController = null;
	}
	if (view.slideController) {
		view.slideController.destroy();
		view.slideController = null;
	}

	const ownerDoc = container.ownerDocument;
	logger.debug('render start', {
		file: view.file?.path,
		containerTag: container.tagName,
		containerClass: container.className
	});

	if (!view.file) {
		container.createDiv({ text: t('tableViewRenderer.noFile') });
		return;
	}

	view.historyManager.reset();

	view.columnLayoutStore.reset(view.file.path);
	view.configManager.reset();
	view.filterStateStore.setFilePath(view.file.path);
	view.filterStateStore.resetState();
	view.tagGroupStore.setFilePath(view.file.path);
	view.tagGroupStore.resetState();
	syncTagGroupState(view);
	view.copyTemplate = null;

	const content = await view.app.vault.read(view.file);
	view.captureConversionBaseline(content);
	const configBlock = await view.persistenceService.loadConfig();

	view.pendingKanbanBoardState = configBlock?.kanbanBoards ?? null;

	if (configBlock) {
		if (configBlock.filterViews) {
			view.filterStateStore.setState(configBlock.filterViews);
		}
		if (configBlock.tagGroups) {
			view.tagGroupStore.setState(configBlock.tagGroups);
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
		const preferredConfig = configBlock?.slide ?? view.slideConfig;
		view.slideConfig = normalizeSlideViewConfig(preferredConfig ?? null);
		view.shouldAutoFillSlideDefaults = !configBlock?.slide;
		view.slideTemplateTouched = Boolean(configBlock?.slide);
		view.slidePreferencesLoaded = true;
	}

	if (!view.kanbanPreferencesLoaded) {
		const preference = configBlock?.viewPreference;
		if (preference === 'kanban' || preference === 'table' || preference === 'slide') view.activeViewMode = preference;
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
syncTagGroupState(view);

const headerColumnConfigs = view.markdownParser.parseHeaderConfig(content);
	const persistedColumnConfigs = configBlock?.columnConfigs
		? deserializeColumnConfigs(view, configBlock.columnConfigs)
		: null;
	const columnConfigs = mergeColumnConfigs(headerColumnConfigs, persistedColumnConfigs);

	const parsedBlocks = view.markdownParser.parseH2Blocks(content);
	if (parsedBlocks.length === 0) {
		container.createDiv({
			text: t('tableViewRenderer.missingH2'),
			cls: 'tlb-warning'
		});
		return;
	}

	view.blocks = parsedBlocks;

	const schemaResult = view.schemaBuilder.buildSchema(view.blocks, columnConfigs ?? null);
	view.dataStore.initialise(schemaResult, columnConfigs ?? null);
	view.schema = view.dataStore.getSchema();
	view.hiddenSortableFields = view.dataStore.getHiddenSortableFields();
	const dirtyFlags = view.dataStore.consumeDirtyFlags();
	view.schemaDirty = dirtyFlags.schemaDirty;
	view.sparseCleanupRequired = dirtyFlags.sparseCleanupRequired;

	if (!view.schema) {
		container.createDiv({ text: t('tableViewRenderer.noSchema') });
		return;
	}
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

	view.filterOrchestrator.refresh();
	view.initialColumnState = null;
	const primaryField = view.schema.columnNames[0] ?? null;

	if (view.filterViewBar) {
		view.filterViewBar.destroy();
		view.filterViewBar = null;
	}
	if (view.kanbanToolbar) {
		view.kanbanToolbar.destroy();
		view.kanbanToolbar = null;
	}
	if (view.activeViewMode === 'slide') {
		renderSlideMode(view, container);
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
	renderFilterViewControls(view, container);

	container.classList.add('tlb-has-grid');

	const columns = [
		{
			field: '#',
			headerName: '',
			headerTooltip: 'Index',
			editable: false
		},
		...buildColumnDefinitions({
			schema: view.schema,
			columnConfigs: view.schema.columnConfigs ?? null,
			primaryField,
			dataStore: view.dataStore,
			columnLayoutStore: view.columnLayoutStore,
			clampWidth: (value) => clampColumnWidth(value, { clampMax: false })
		})
	];

	const isDarkMode = ownerDoc.body.classList.contains('theme-dark');
	const themeClass = isDarkMode ? 'ag-theme-quartz-dark' : 'ag-theme-quartz';
	const plugin = getPluginContext();
	const tableContainer = container.createDiv({ cls: `tlb-table-container ${themeClass}` });
	const stripeStrengthRaw = plugin?.getRowStripeStrength?.() ?? 0.32;
	const stripeStrength = Math.min(1, Math.max(0, stripeStrengthRaw));
	const borderContrast = plugin?.getBorderContrast?.() ?? 0.16;
	let effectiveStripeStrength = stripeStrength;
	tableContainer.style.setProperty('--tlb-row-stripe-strength', String(stripeStrength));
	tableContainer.style.setProperty('--tlb-border-contrast', String(borderContrast));
	const docStyles = ownerDoc.defaultView ? ownerDoc.defaultView.getComputedStyle(ownerDoc.body) : null;
	const primary = docStyles?.getPropertyValue('--background-primary')?.trim() ?? '';
	const secondary = docStyles?.getPropertyValue('--background-secondary')?.trim() ?? '';
	const primaryAlt = docStyles?.getPropertyValue('--background-primary-alt')?.trim() ?? '';
	const textColor = docStyles?.getPropertyValue('--text-normal')?.trim() ?? '';
	const hoverColor = docStyles?.getPropertyValue('--background-modifier-hover')?.trim() ?? '';
	const parseCssColor = (value: string | null | undefined) => {
		if (!value) { return null; }
		const trimmed = value.trim();
		const hexMatch = trimmed.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
		if (hexMatch) {
			const hex = hexMatch[1];
			const expand = (chunk: string) => chunk.length === 1 ? chunk + chunk : chunk;
			const toChannel = (chunk: string) => parseInt(expand(chunk), 16);
			const alphaChunk = hex.length === 4 ? hex.slice(3) : hex.length === 8 ? hex.slice(6, 8) : null;
			const r = toChannel(hex.slice(0, hex.length === 3 || hex.length === 4 ? 1 : 2));
			const g = toChannel(hex.slice(hex.length === 3 || hex.length === 4 ? 1 : 2, hex.length === 3 || hex.length === 4 ? 2 : 4));
			const b = toChannel(hex.slice(hex.length === 3 || hex.length === 4 ? 2 : 4, hex.length === 3 || hex.length === 4 ? 3 : 6));
			const a = alphaChunk ? toChannel(alphaChunk) / 255 : 1;
			return { r, g, b, a };
		}
		const parseRgbNumbers = (input: string) => {
			const numericParts = input.match(/[\d.]+%?/g);
			if (!numericParts || numericParts.length < 3) { return null; }
			const [rRaw, gRaw, bRaw, aRaw] = numericParts;
			const parseChannel = (component: string, scale = 255) => {
				const inner = component.trim();
				if (!inner) { return null; }
				if (inner.endsWith('%')) {
					const percent = Number(inner.slice(0, -1));
					return Number.isFinite(percent) ? (percent / 100) * scale : null;
				}
				const numeric = Number(inner);
				return Number.isFinite(numeric) ? numeric : null;
			};
			const r = parseChannel(rRaw);
			const g = parseChannel(gRaw);
			const b = parseChannel(bRaw);
			const a = aRaw ? parseChannel(aRaw, 1) : 1;
			if (
				r == null ||
				g == null ||
				b == null ||
				a == null ||
				Number.isNaN(r) ||
				Number.isNaN(g) ||
				Number.isNaN(b) ||
				Number.isNaN(a)
			) {
				return null;
			}
			return { r, g, b, a };
		};
		const direct = parseRgbNumbers(trimmed);
		if (direct) { return direct; }
		const probe = ownerDoc.createElement('div');
		probe.style.color = trimmed;
		ownerDoc.body.appendChild(probe);
		const computed = ownerDoc.defaultView?.getComputedStyle(probe).color ?? '';
		probe.remove();
		return parseRgbNumbers(computed);
	};
	const computeLuminance = (color: { r: number; g: number; b: number }) => {
		const toLinear = (channel: number) => {
			const normalized = channel / 255;
			return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
		};
		return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
	};
	const contrastRatio = (a: string | null | undefined, b: string | null | undefined) => {
		const parsedA = parseCssColor(a);
		const parsedB = parseCssColor(b);
		if (!parsedA || !parsedB) { return Number.POSITIVE_INFINITY; }
		const lumA = computeLuminance(parsedA);
		const lumB = computeLuminance(parsedB);
		return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
	};
	const hasLowContrast = (a: string | null | undefined, b: string | null | undefined, threshold = 1.1) =>
		contrastRatio(a, b) < threshold;
	const colorsClose = (a: string | null | undefined, b: string | null | undefined) => {
		if (!a || !b) { return false; }
		if (a === b) { return true; }
		const parsedA = parseCssColor(a);
		const parsedB = parseCssColor(b);
		if (!parsedA || !parsedB) { return false; }
		const channelDistance = Math.max(
			Math.abs(parsedA.r - parsedB.r),
			Math.abs(parsedA.g - parsedB.g),
			Math.abs(parsedA.b - parsedB.b)
		);
		const alphaDistance = Math.abs(parsedA.a - parsedB.a);
		return channelDistance <= 6 && alphaDistance <= 0.02;
	};
	const colorsEqual = (a: string | null | undefined, b: string | null | undefined) =>
		!!a && !!b && (a === b || colorsClose(a, b));
	const primaryColor = primary || 'var(--background-primary)';
	const textFallback = textColor || 'var(--text-normal)';
	const fallbackStripeBase = isDarkMode ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.08)';
	const altUsable = primaryAlt && !colorsEqual(primaryAlt, primary) && !hasLowContrast(primaryAlt, primary);
	const secondaryUsable = secondary && !colorsEqual(secondary, primary) && !hasLowContrast(secondary, primary);
	const hoverUsable = hoverColor && !colorsEqual(hoverColor, primary) && !hasLowContrast(hoverColor, primary);
	const syntheticStripeBase = `color-mix(in srgb, ${primaryColor} 70%, ${textFallback} 30%)`;
	const stripeBaseCandidate = altUsable
		? primaryAlt
		: secondaryUsable
			? secondary
			: hoverUsable
				? hoverColor
				: fallbackStripeBase;
	const fallbackActive = !altUsable && !secondaryUsable;
	const stripeBase =
		stripeBaseCandidate && stripeBaseCandidate.trim().length > 0 ? stripeBaseCandidate : fallbackStripeBase;
	const stripeBaseTooClose = colorsEqual(stripeBase, primary) || hasLowContrast(stripeBase, primary);
	const resolvedStripeBase = stripeBaseTooClose ? fallbackStripeBase : stripeBase;
	tableContainer.style.setProperty('--tlb-odd-row-base', resolvedStripeBase || syntheticStripeBase);
	const forceStripe = fallbackActive || stripeBaseTooClose;
	if (forceStripe) {
		effectiveStripeStrength = Math.max(stripeStrength, 0.6);
		const forcedMix = `calc(var(--tlb-row-stripe-strength-effective, ${effectiveStripeStrength}) * 100%)`;
		const forcedStripeCss = `color-mix(in srgb, ${primaryColor} calc(100% - ${forcedMix}), ${textFallback} ${forcedMix})`;
		tableContainer.classList.add('tlb-force-odd-row-stripe');
		tableContainer.style.setProperty('--tlb-odd-row-override', forcedStripeCss, 'important');
		tableContainer.style.setProperty('--ag-odd-row-background-color', forcedStripeCss, 'important');
	} else {
		tableContainer.classList.remove('tlb-force-odd-row-stripe');
		tableContainer.style.removeProperty('--tlb-odd-row-override');
		tableContainer.style.removeProperty('--ag-odd-row-background-color');
	}
	tableContainer.style.setProperty('--tlb-row-stripe-strength-effective', String(effectiveStripeStrength));
	const hideRightSidebar = plugin?.isHideRightSidebarEnabled() ?? false;
	const sideBarVisible = !hideRightSidebar;

	const containerWindow = ownerDoc?.defaultView ?? window;
	const executeMount = () => {
		const { gridAdapter, container: gridContainer } = mountGrid({
			gridController: view.gridController,
			container: tableContainer,
			columns,
			rowData: view.filterOrchestrator.getVisibleRows(),
			sideBarVisible,
			handlers: {
				onStatusChange: (rowId, newStatus) => handleStatusChange(view, rowId, newStatus),
				onColumnResize: (field, width) => handleColumnResize(view, field, width),
				onCopySelectionAsTemplate: (rowIndex) => {
					void view.gridInteractionController.copySectionAsTemplate(rowIndex);
				},
				onCopyH2Section: (rowIndex) => {
					void view.gridInteractionController.copySectionAsTemplate(rowIndex);
				},
				onColumnOrderChange: (fields) => handleColumnOrderChange(view, fields),
				onModelUpdated: () => view.focusManager.handleGridModelUpdated(),
				onCellEdit: (event) => handleCellEdit(view, event),
				onHeaderEdit: (event) => handleHeaderEditEvent(view, event),
				onColumnHeaderContextMenu: (field, event) => view.columnInteractionController.handleColumnHeaderContextMenu(field, event),
				onOpenCellLink: (context) => handleCellLinkOpen(view, context),
				onEnterAtLastRow: (field) => {
					const oldRowCount = view.blocks.length;
					view.rowInteractionController.addRow(oldRowCount, { focusField: field ?? null });
				},
				onRowDragEnd: (payload) => {
					view.rowInteractionController.reorderRowsByDrag(payload);
				}
			}
		});

	view.gridAdapter = gridAdapter;
		view.tableContainer = gridContainer;
		view.gridLayoutController.attach(gridContainer);
		view.filterOrchestrator.applyActiveView();
		view.gridInteractionController.attach(gridContainer);
	};

	if (containerWindow && typeof containerWindow.requestAnimationFrame === 'function') {
		containerWindow.requestAnimationFrame(() => {
			executeMount();
		});
	} else {
		executeMount();
	}
}

