import type { TableView } from '../../TableView';
import { normalizeSlideViewConfig } from '../../types/slide';
import { renderSlideView } from './renderSlideView';
import { SlideTemplateModal } from './SlideTemplateModal';

export function renderSlideMode(view: TableView, container: HTMLElement): void {
	container.classList.add('tlb-slide-mode');
	const slideContainer = container.createDiv({ cls: 'tlb-slide-container' });
	const slideRows = view.dataStore.extractRowData();
	const slideConfig = normalizeSlideViewConfig(view.slideConfig);

	view.slideController = renderSlideView({
		container: slideContainer,
		rows: slideRows,
		fields: view.schema?.columnNames ?? [],
		config: slideConfig,
		onExit: () => {
			void view.setActiveViewMode(view.previousNonSlideMode ?? 'table');
		},
		onEditTemplate: () => {
			const modal = new SlideTemplateModal({
				app: view.app,
				fields: view.schema?.columnNames ?? [],
				initial: slideConfig.template,
				onSave: (nextTemplate) => {
					view.slideConfig = {
						...slideConfig,
						template: nextTemplate
					};
					view.slideController?.controller.updateConfig(view.slideConfig);
					view.markUserMutation('slide-template');
					view.persistenceService.scheduleSave();
				}
			});
			modal.open();
		}
	});
}
