import { getPluginContext } from '../pluginContext';
import { t } from '../i18n';
import { getLogger } from '../utils/logger';
import type { TableView } from '../TableView';

const logger = getLogger('view:table');

export function ensureMarkdownToggle(view: TableView): void {
	if (view.markdownToggleButton) {
		return;
	}

	const label = t('viewControls.openMarkdownView');
	const button = view.addAction('pencil', label, async (evt) => {
		const plugin = getPluginContext();
		if (!plugin) {
			logger.warn('No plugin context when toggling to markdown view');
			return;
		}
		try {
			await plugin.toggleLeafView(view.leaf);
		} catch (error) {
			logger.error('Failed to toggle back to markdown view', error);
		}
		evt?.preventDefault();
		evt?.stopPropagation();
	});
	button.setAttribute('data-tlb-action', 'open-markdown-view');
	button.setAttribute('aria-label', label);
	view.markdownToggleButton = button;
}
