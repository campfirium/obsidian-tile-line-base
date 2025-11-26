import type { TableView } from '../../TableView';
import { getDefaultBodyLayout, getDefaultTitleLayout, normalizeSlideViewConfig, type SlideTextTemplate } from '../../types/slide';
import { renderSlideView } from './renderSlideView';
import { SlideTemplateModal } from './SlideTemplateModal';

export function renderSlideMode(view: TableView, container: HTMLElement): void {
	container.classList.add('tlb-slide-mode');
	const slideContainer = container.createDiv({ cls: 'tlb-slide-container' });
	const slideRows = view.dataStore.extractRowData();
	const baseConfig = normalizeSlideViewConfig(view.slideConfig);
	const effectiveConfig = applyDefaultTemplates(baseConfig, view.schema?.columnNames ?? []);
	view.slideConfig = effectiveConfig;

	view.slideController = renderSlideView({
		app: view.app,
		sourcePath: view.file?.path ?? view.app.workspace.getActiveFile()?.path ?? '',
		container: slideContainer,
		rows: slideRows,
		fields: view.schema?.columnNames ?? [],
		config: effectiveConfig,
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
			const freshConfig = applyDefaultTemplates(
				normalizeSlideViewConfig(view.slideConfig),
				view.schema?.columnNames ?? []
			);
			view.slideConfig = freshConfig;
			const modal = new SlideTemplateModal({
				app: view.app,
				fields: view.schema?.columnNames ?? [],
				initial: freshConfig.template,
				onSave: (nextTemplate) => {
					const nextConfig = { ...freshConfig, template: nextTemplate };
					view.slideConfig = nextConfig;
					view.slideController?.controller.updateConfig(view.slideConfig);
					view.markUserMutation('slide-template');
					view.persistenceService.scheduleSave();
				}
			});
			modal.open();
		}
	});
}

function applyDefaultTemplates(config: ReturnType<typeof normalizeSlideViewConfig>, fields: string[]): typeof config {
	const available = fields.filter((field) => field && field !== '#' && field !== '__tlb_row_id');
	const defaultTitle = available[0] ? `{${available[0]}}` : '';
	const defaultBody = available.slice(1).map((field) => `{${field}}`).join('\n');
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
					imageTemplate: config.template.single.withImage.imageTemplate ?? '',
					imageLayout: config.template.single.withImage.imageLayout ?? getDefaultBodyLayout()
				},
				withoutImage: normalizeText(config.template.single.withoutImage)
			},
			split: {
				withImage: {
					imageTemplate: config.template.split.withImage.imageTemplate ?? '',
					textPage: normalizeText(config.template.split.withImage.textPage),
					imagePage: {
						showTitle: config.template.split.withImage.imagePage.showTitle !== false,
						imageTemplate: config.template.split.withImage.imagePage.imageTemplate ?? '',
						titleLayout: config.template.split.withImage.imagePage.titleLayout ?? getDefaultTitleLayout(),
						imageLayout: config.template.split.withImage.imagePage.imageLayout ?? getDefaultBodyLayout()
					}
				},
				withoutImage: normalizeText(config.template.split.withoutImage)
			}
		}
	};
}
