import type { RowData } from '../../grid/GridAdapter';
import type { SlideViewConfig } from '../../types/slide';
import { SlideViewController } from './SlideViewController';

export interface SlideViewInstance {
	controller: SlideViewController;
	destroy(): void;
}

interface RenderSlideViewOptions {
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	config: SlideViewConfig;
	onExit: () => void;
	onEditTemplate: () => void;
}

export function renderSlideView(options: RenderSlideViewOptions): SlideViewInstance {
	const controller = new SlideViewController({
		container: options.container,
		rows: options.rows,
		fields: options.fields,
		config: options.config,
		onExit: options.onExit,
		onEditTemplate: options.onEditTemplate
	});

	return {
		controller,
		destroy: () => controller.destroy()
	};
}
