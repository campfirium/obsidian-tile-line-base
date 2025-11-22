import type { TableView } from '../../TableView';
import { normalizeSlideViewConfig } from '../../types/slide';
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
		container: slideContainer,
		rows: slideRows,
		fields: view.schema?.columnNames ?? [],
		config: effectiveConfig,
		onExit: () => {
			void view.setActiveViewMode(view.previousNonSlideMode ?? 'table');
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
	const titleTemplate = config.template.titleTemplate && config.template.titleTemplate.trim().length > 0
		? config.template.titleTemplate
		: defaultTitle;
	const bodyTemplate = config.template.bodyTemplate && config.template.bodyTemplate.trim().length > 0
		? config.template.bodyTemplate
		: defaultBody;
	return {
		...config,
		template: {
			titleTemplate,
			bodyTemplate,
			titleColor: config.template.titleColor ?? '',
			bodyColor: config.template.bodyColor ?? '',
			backgroundColor: config.template.backgroundColor ?? ''
		}
	};
}
