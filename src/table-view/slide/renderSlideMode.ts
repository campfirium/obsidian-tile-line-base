import { Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { getPluginContext } from '../../pluginContext';
import {
	getDefaultBodyLayout,
	getDefaultTitleLayout,
	isDefaultSlideViewConfig,
	normalizeSlideViewConfig,
	type SlideTextTemplate
} from '../../types/slide';
import { getLogger } from '../../utils/logger';
import { renderSlideView } from './renderSlideView';
import { SlideTemplateModal } from './SlideTemplateModal';

const logger = getLogger('slide:render-mode');

export function renderSlideMode(view: TableView, container: HTMLElement): void {
	container.classList.add('tlb-slide-mode');
	const slideContainer = container.createDiv({ cls: 'tlb-slide-container' });
	const slideRows = view.dataStore.extractRowData();
	const fields = view.schema?.columnNames ?? [];
	const renderState = buildRenderConfig({
		config: view.slideConfig,
		fields,
		allowAutoFill: view.shouldAutoFillSlideDefaults,
		templateTouched: view.slideTemplateTouched
	});
	view.slideConfig = renderState.normalizedConfig;
	view.shouldAutoFillSlideDefaults = renderState.allowAutoFillNext;
	view.slideTemplateTouched = renderState.templateTouched;
	const plugin = getPluginContext();

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
						config: nextConfig,
						fields,
						allowAutoFill: false,
						templateTouched: true
					});
					view.slideTemplateTouched = nextRenderState.templateTouched;
					view.shouldAutoFillSlideDefaults = nextRenderState.allowAutoFillNext;
					view.slideConfig = nextRenderState.normalizedConfig;
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

function applyDefaultTemplates(config: ReturnType<typeof normalizeSlideViewConfig>, fields: string[]): typeof config {
	const available = fields.filter(
		(field) => field && !['#', '__tlb_row_id', '__tlb_status', '__tlb_index', 'status', 'statusChanged'].includes(field)
	);
	const defaultTitle = available[0] ? `{${available[0]}}` : '';
	const defaultBody = available.slice(1).map((field) => `{${field}}`).join('\n');
	const defaultImageTemplate = '';
	const normalizeText = (template: SlideTextTemplate): SlideTextTemplate => {
		const titleTemplate = template.titleTemplate && template.titleTemplate.trim().length > 0 ? template.titleTemplate : defaultTitle;
		const bodyTemplate = template.bodyTemplate && template.bodyTemplate.trim().length > 0 ? template.bodyTemplate : defaultBody;
		return {
			titleTemplate,
			bodyTemplate,
			titleLayout: template.titleLayout ?? getDefaultTitleLayout(),
			bodyLayout: template.bodyLayout ?? getDefaultBodyLayout()
		};
	};
	return {
		...config,
		template: {
			mode: config.template.mode ?? 'single',
			textColor: config.template.textColor ?? '',
			backgroundColor: config.template.backgroundColor ?? '',
			single: {
				withImage: {
					...normalizeText(config.template.single.withImage),
					imageTemplate:
						config.template.single.withImage.imageTemplate && config.template.single.withImage.imageTemplate.trim().length > 0
							? config.template.single.withImage.imageTemplate
							: defaultImageTemplate,
					imageLayout: config.template.single.withImage.imageLayout ?? getDefaultBodyLayout()
				},
				withoutImage: normalizeText(config.template.single.withoutImage)
			},
			split: {
				withImage: {
					imageTemplate:
						config.template.split.withImage.imageTemplate && config.template.split.withImage.imageTemplate.trim().length > 0
							? config.template.split.withImage.imageTemplate
							: defaultImageTemplate,
					textPage: normalizeText(config.template.split.withImage.textPage),
					imageLayout:
						config.template.split.withImage.imageLayout ??
						getDefaultBodyLayout()
				},
				withoutImage: normalizeText(config.template.split.withoutImage)
			}
		}
	};
}

function buildRenderConfig(options: {
	config: ReturnType<typeof normalizeSlideViewConfig>;
	fields: string[];
	allowAutoFill: boolean;
	templateTouched: boolean;
}): {
	normalizedConfig: ReturnType<typeof normalizeSlideViewConfig>;
	renderConfig: ReturnType<typeof normalizeSlideViewConfig>;
	templateTouched: boolean;
	allowAutoFillNext: boolean;
	appliedDefaults: boolean;
} {
	const baseConfig = ensureLayoutDefaults(normalizeSlideViewConfig(options.config));
	const canAutoFill = options.allowAutoFill && !options.templateTouched && isDefaultSlideViewConfig(baseConfig);
	const renderConfig = canAutoFill ? applyDefaultTemplates(baseConfig, options.fields) : baseConfig;
	return {
		normalizedConfig: baseConfig,
		renderConfig,
		templateTouched: options.templateTouched || canAutoFill,
		allowAutoFillNext: options.allowAutoFill && !canAutoFill,
		appliedDefaults: canAutoFill
	};
}
