const KANBAN_FONT_SCALE_STYLE_ID = 'tlb-kanban-font-scale-style';
const KANBAN_FONT_SCALE_STYLES = `
.tlb-kanban-root { --tlb-kanban-font-scale: 1; }
.tlb-kanban-root .tlb-kanban-message {
\tfont-size: calc(var(--font-ui-smaller) * var(--tlb-kanban-font-scale, 1));
}
.tlb-kanban-root .tlb-kanban-lane__count,
.tlb-kanban-root .tlb-kanban-lane__load-more,
.tlb-kanban-root .tlb-kanban-lane__placeholder,
.tlb-kanban-root .tlb-kanban-card__fields,
.tlb-kanban-root .tlb-kanban-card__field-more,
.tlb-kanban-root .tlb-kanban-card__body,
.tlb-kanban-root .tlb-kanban-card__tag {
\tfont-size: calc(var(--font-ui-smaller) * var(--tlb-kanban-font-scale, 1));
}
.tlb-kanban-root .tlb-kanban-card {
\tfont-size: calc(var(--font-ui-small, 0.95rem) * var(--tlb-kanban-font-scale, 1));
}
.tlb-kanban-root .tlb-kanban-tooltip {
\tfont-size: calc((var(--font-ui-smaller, var(--font-ui-small, 0.85rem))) * 1.2 * var(--tlb-kanban-font-scale, 1));
}
.tlb-kanban-root .tlb-kanban-empty__icon {
\tfont-size: calc(2rem * var(--tlb-kanban-font-scale, 1));
}
.tlb-kanban-root .tlb-kanban-empty__label {
\tfont-size: calc(var(--font-ui-small) * var(--tlb-kanban-font-scale, 1));
}
`;

export function ensureFontScaleStyles(doc: Document): void {
	if (doc.getElementById(KANBAN_FONT_SCALE_STYLE_ID)) {
		return;
	}
	const style = doc.createElement('style');
	style.id = KANBAN_FONT_SCALE_STYLE_ID;
	style.textContent = KANBAN_FONT_SCALE_STYLES;
	doc.head.appendChild(style);
}
