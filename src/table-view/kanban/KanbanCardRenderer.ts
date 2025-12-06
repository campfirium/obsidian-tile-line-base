import { t } from '../../i18n';
import type { KanbanRuntimeCardContent } from '../../types/kanban';
import type { KanbanTooltipManager } from './KanbanTooltipManager';
import type { KanbanLane } from './KanbanDataBuilder';

interface RenderKanbanCardOptions {
	container: HTMLElement;
	card: KanbanLane['cards'][number];
	cardContent: KanbanRuntimeCardContent;
	tooltipManager: KanbanTooltipManager;
}

export function renderKanbanCard(options: RenderKanbanCardOptions): HTMLElement {
	const { container, card, cardContent, tooltipManager } = options;
	const cardEl = container.createDiv({
		cls: 'tlb-kanban-card',
		attr: {
			'data-row-index': String(card.rowIndex),
			'data-card-id': card.id,
			'data-lane-name': card.rawLane
		}
	});
	cardEl.setAttribute('tabindex', '0');

	const title = cardEl.createDiv({ cls: 'tlb-kanban-card__title' });
	const titleText = title.createSpan({ cls: 'tlb-kanban-card__title-text' });
	const trimmedTitle = card.title.trim();
	titleText.setText(trimmedTitle.length > 0 ? trimmedTitle : t('kanbanView.untitledCardFallback'));
	if (!cardContent.tagsBelowBody && card.tags.length > 0) {
		const tagsInline = title.createSpan({
			cls: 'tlb-kanban-card__tags tlb-kanban-card__tags--inline'
		});
		renderTags(tagsInline, card.tags);
	}

	const bodyText = card.body.trim();
	const showBody = cardContent.showBody && bodyText.length > 0;
	if (!showBody && bodyText.length > 0) {
		cardEl.addClass('tlb-kanban-card--tooltip');
		tooltipManager.register(cardEl, bodyText);
	} else {
		cardEl.removeClass('tlb-kanban-card--tooltip');
		tooltipManager.unregister(cardEl);
	}
	if (showBody) {
		const bodyEl = cardEl.createDiv({ cls: 'tlb-kanban-card__body' });
		bodyEl.setText(bodyText);
	}

	if (card.tags.length > 0 && cardContent.tagsBelowBody) {
		const tagsBlock = cardEl.createDiv({
			cls: 'tlb-kanban-card__tags tlb-kanban-card__tags--block'
		});
		renderTags(tagsBlock, card.tags);
	}

	cardEl.toggleClass('tlb-kanban-card--compact', !showBody);

	if (card.fields.length > 0) {
		const fieldsEl = cardEl.createDiv({ cls: 'tlb-kanban-card__fields' });
		for (const field of card.fields.slice(0, 6)) {
			const fieldRow = fieldsEl.createDiv({ cls: 'tlb-kanban-card__field' });
			const nameEl = fieldRow.createSpan({ cls: 'tlb-kanban-card__field-name' });
			nameEl.setText(field.name);
			const valueEl = fieldRow.createSpan({ cls: 'tlb-kanban-card__field-value' });
			valueEl.setText(field.value);
		}
		if (card.fields.length > 6) {
			const more = fieldsEl.createDiv({ cls: 'tlb-kanban-card__field-more' });
			more.setText(t('kanbanView.moreFieldsLabel', { count: String(card.fields.length - 6) }));
		}
	}

	return cardEl;
}

const renderTags = (container: HTMLElement, tags: string[]): void => {
	for (const tag of tags) {
		const tagEl = container.createSpan({ cls: 'tlb-kanban-card__tag' });
		tagEl.setText(tag);
	}
};
