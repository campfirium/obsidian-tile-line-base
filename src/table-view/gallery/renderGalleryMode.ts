import type { TableView } from '../../TableView';
import { GalleryViewController } from './GalleryViewController';
import { buildBuiltInSlideTemplate, mergeSlideTemplateFields } from '../slide/slideDefaults';
import { normalizeSlideViewConfig } from '../../types/slide';

export function renderGalleryMode(view: TableView, container: HTMLElement): void {
	container.classList.add('tlb-gallery-mode');
	const galleryContainer = container.createDiv({ cls: 'tlb-gallery-container' });
	const rows = view.filterOrchestrator.getVisibleRows();
	const fields = view.schema?.columnNames ?? [];
	const sourcePath = view.file?.path ?? view.app.workspace.getActiveFile()?.path ?? '';
	const shouldApplyBuiltIn = view.shouldAutoFillGalleryDefaults;
	const builtInTemplate = buildBuiltInSlideTemplate(fields);
	const baseConfig = normalizeSlideViewConfig(view.galleryConfig);
	const hydratedConfig = shouldApplyBuiltIn
		? normalizeSlideViewConfig({
				...baseConfig,
				template: mergeSlideTemplateFields(baseConfig.template, builtInTemplate)
			})
		: baseConfig;
	view.galleryConfig = hydratedConfig;
	view.shouldAutoFillGalleryDefaults = false;
	view.galleryTemplateTouched = view.galleryTemplateTouched || shouldApplyBuiltIn;

	const controller = new GalleryViewController({
		app: view.app,
		container: galleryContainer,
		rows,
		fields,
		config: view.galleryConfig,
		sourcePath,
		onSaveRow: async (row, values) => {
			const rowIndex = view.dataStore.getBlockIndexFromRow(row);
			if (rowIndex == null) return;
			for (const [field, value] of Object.entries(values)) {
				view.dataStore.updateCell(rowIndex, field, value);
			}
			view.markUserMutation('gallery-inline-edit');
			view.persistenceService.scheduleSave();
			view.filterOrchestrator.refresh();
			return view.filterOrchestrator.getVisibleRows();
		},
		onTemplateChange: () => {
			view.galleryTemplateTouched = true;
			view.shouldAutoFillGalleryDefaults = false;
			view.markUserMutation('gallery-template');
			view.persistenceService.scheduleSave();
		}
	});

	view.galleryController = controller;
	view.filterOrchestrator.applyActiveView();
}
