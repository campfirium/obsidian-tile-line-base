import type { App } from 'obsidian';
import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import { SlideViewController } from './SlideViewController';

export interface SlideViewInstance {
	controller: SlideViewController;
	destroy(): void;
}

interface RenderSlideViewOptions {
	app: App;
	sourcePath: string;
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	onSaveRow: (row: RowData, values: Record<string, string>) => Promise<RowData[] | void>;
	onEditTemplate: () => void;
}

export function renderSlideView(options: RenderSlideViewOptions): SlideViewInstance {
	const controller = new SlideViewController({
		app: options.app,
		sourcePath: options.sourcePath,
		container: options.container,
		rows: options.rows,
		fields: options.fields,
		config: options.config,
		onSaveRow: options.onSaveRow,
		onEditTemplate: options.onEditTemplate
	});

	return {
		controller,
		destroy: () => controller.destroy()
	};
}
