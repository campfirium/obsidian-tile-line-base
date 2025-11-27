import { Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { getPluginContext } from '../../pluginContext';
import {
	getDefaultBodyLayout,
	getDefaultTitleLayout,
	normalizeSlideViewConfig
} from '../../types/slide';
import { getLogger } from '../../utils/logger';
import { renderSlideView } from './renderSlideView';
import { SlideTemplateModal } from './SlideTemplateModal';
import { buildBuiltInSlideTemplate } from './slideDefaults';

const logger = getLogger('slide:render-mode');

export function renderSlideMode(view: TableView, container: HTMLElement): void {
	container.classList.add('tlb-slide-mode');
	const slideContainer = container.createDiv({ cls: 'tlb-slide-container' });
	const slideRows = view.dataStore.extractRowData();
	const fields = view.schema?.columnNames ?? [];
	const plugin = getPluginContext();
	const baseTemplate = plugin?.getDefaultSlideConfig?.()?.template ?? view.slideConfig.template;
	const shouldApplyBuiltIn = view.shouldAutoFillSlideDefaults;
	const hydratedConfig = shouldApplyBuiltIn
		? normalizeSlideViewConfig({
				...view.slideConfig,
				template: buildBuiltInSlideTemplate(fields, baseTemplate)
			})
		: view.slideConfig;
	const renderState = buildRenderConfig({
		config: hydratedConfig
	});
	view.slideConfig = renderState.renderConfig;
	view.shouldAutoFillSlideDefaults = false;
	view.slideTemplateTouched = view.slideTemplateTouched || shouldApplyBuiltIn;
	if (shouldApplyBuiltIn && plugin?.setDefaultSlideConfig) {
		void plugin.setDefaultSlideConfig(renderState.renderConfig).catch((error: unknown) => {
			logger.warn('Failed to persist built-in slide preset as global default', error);
		});
	}

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

function ensureLayoutDefaults(config: ReturnType<typeof normalizeSlideViewConfig>): typeof config {
	const template = config.template;
	return {
		...config,
		template: {
			mode: template.mode ?? 'single',
			textColor: template.textColor ?? '',
			backgroundColor: template.backgroundColor ?? '',
			single: {
				withImage: {
					...template.single.withImage,
					titleLayout: template.single.withImage.titleLayout ?? getDefaultTitleLayout(),
					bodyLayout: template.single.withImage.bodyLayout ?? getDefaultBodyLayout(),
					imageLayout: template.single.withImage.imageLayout ?? getDefaultBodyLayout()
				},
				withoutImage: {
					...template.single.withoutImage,
					titleLayout: template.single.withoutImage.titleLayout ?? getDefaultTitleLayout(),
					bodyLayout: template.single.withoutImage.bodyLayout ?? getDefaultBodyLayout()
				}
			},
			split: {
				withImage: {
					...template.split.withImage,
					textPage: {
						...template.split.withImage.textPage,
						titleLayout: template.split.withImage.textPage.titleLayout ?? getDefaultTitleLayout(),
						bodyLayout: template.split.withImage.textPage.bodyLayout ?? getDefaultBodyLayout()
					},
					imageLayout: template.split.withImage.imageLayout ?? getDefaultBodyLayout()
				},
				withoutImage: {
					...template.split.withoutImage,
					titleLayout: template.split.withoutImage.titleLayout ?? getDefaultTitleLayout(),
					bodyLayout: template.split.withoutImage.bodyLayout ?? getDefaultBodyLayout()
				}
			}
		}
	};
}

function buildRenderConfig(options: {
	config: ReturnType<typeof normalizeSlideViewConfig>;
}): {
	normalizedConfig: ReturnType<typeof normalizeSlideViewConfig>;
	renderConfig: ReturnType<typeof normalizeSlideViewConfig>;
	templateTouched: boolean;
	allowAutoFillNext: boolean;
	appliedDefaults: boolean;
} {
	const baseConfig = ensureLayoutDefaults(normalizeSlideViewConfig(options.config));
	const renderConfig = baseConfig;
	return {
		normalizedConfig: baseConfig,
		renderConfig,
		templateTouched: true,
		allowAutoFillNext: false,
		appliedDefaults: false
	};
}
