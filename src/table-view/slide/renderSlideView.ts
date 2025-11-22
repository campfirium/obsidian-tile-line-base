import type { RowData } from '../../grid/GridAdapter';
import { SlideViewController } from './SlideViewController';

export interface SlideViewInstance {
	controller: SlideViewController;
	destroy(): void;
}

interface RenderSlideViewOptions {
	container: HTMLElement;
	rows: RowData[];
	fields: string[];
	onExit: () => void;
}

export function renderSlideView(options: RenderSlideViewOptions): SlideViewInstance {
	const controller = new SlideViewController({
		container: options.container,
		rows: options.rows,
		fields: options.fields,
		onExit: options.onExit
	});

	return {
		controller,
		destroy: () => controller.destroy()
	};
}
