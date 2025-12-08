import { Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { getPluginContext } from '../../pluginContext';
import { normalizeSlideViewConfig } from '../../types/slide';
import { getLogger } from '../../utils/logger';
import { renderSlideView } from './renderSlideView';
import { SlideTemplateModal } from './SlideTemplateModal';
import { buildBuiltInSlideTemplate, mergeSlideTemplateFields } from './slideDefaults';
import { buildRenderConfig, ensureLayoutDefaults } from './slideConfigHelpers';

const logger = getLogger('slide:render-mode');

export function renderSlideMode(view: TableView, container: HTMLElement): void {
	container.classList.add('tlb-slide-mode');
	const slideContainer = container.createDiv({ cls: 'tlb-slide-container' });
	const slideRows = view.dataStore.extractRowData();
	const fields = view.schema?.columnNames ?? [];
	const shouldApplyBuiltIn = view.shouldAutoFillSlideDefaults;
	const baseConfig = normalizeSlideViewConfig(view.slideConfig);
	const builtInTemplate = buildBuiltInSlideTemplate(fields);
	const plugin = getPluginContext();
	const globalConfig = plugin?.getDefaultSlideConfig?.() ?? null;
	const globalConfigNormalized = globalConfig ? normalizeSlideViewConfig(globalConfig) : null;
	const hydratedConfig = shouldApplyBuiltIn
		? globalConfigNormalized
			? normalizeSlideViewConfig({
					...globalConfigNormalized,
					template: mergeSlideTemplateFields(globalConfigNormalized.template, builtInTemplate)
				})
			: normalizeSlideViewConfig({
					...baseConfig,
					template: builtInTemplate
				})
		: baseConfig;
	const renderState = buildRenderConfig({
		config: hydratedConfig
	});
	view.slideConfig = renderState.renderConfig;
	view.shouldAutoFillSlideDefaults = false;
	view.slideTemplateTouched = view.slideTemplateTouched || shouldApplyBuiltIn;

	view.slideController = renderSlideView({
		app: view.app,
		sourcePath: view.file?.path ?? view.app.workspace.getActiveFile()?.path ?? '',
		container: slideContainer,
		rows: slideRows,
		fields,
		config: renderState.renderConfig,
		onSaveRow: async (row, values) => {
			const rowIndex = view.dataStore.getBlockIndexFromRow(row);
			if (rowIndex == null) return;
			for (const [field, value] of Object.entries(values)) {
				view.dataStore.updateCell(rowIndex, field, value);
			}
			view.markUserMutation('slide-inline-edit');
			view.persistenceService.scheduleSave();
			return view.dataStore.extractRowData();
		},
		onEditTemplate: () => {
			const baseConfig = ensureLayoutDefaults(normalizeSlideViewConfig(view.slideConfig));
			view.slideConfig = baseConfig;
			const modal = new SlideTemplateModal({
				app: view.app,
				fields,
				initial: baseConfig.template,
				onSave: (nextTemplate) => {
					const nextConfig = ensureLayoutDefaults(normalizeSlideViewConfig({ ...baseConfig, template: nextTemplate }));
					const nextRenderState = buildRenderConfig({
						config: nextConfig
					});
					view.slideTemplateTouched = true;
					view.shouldAutoFillSlideDefaults = false;
					view.slideConfig = nextRenderState.renderConfig;
					view.slideController?.controller.updateConfig(nextRenderState.renderConfig);
					view.markUserMutation('slide-template');
					view.persistenceService.scheduleSave();
				},
				onSaveDefault: plugin
					? async (nextTemplate) => {
						try {
							const nextConfig = normalizeSlideViewConfig({ ...baseConfig, template: nextTemplate });
							await plugin.setDefaultSlideConfig(nextConfig);
							new Notice(t('slideView.templateModal.setDefaultSuccess'));
						} catch (error) {
							logger.error('Failed to set slide template as default', error);
							new Notice(t('slideView.templateModal.setDefaultError'));
						}
					}
					: undefined
			});
			modal.open();
		}
	});
}
