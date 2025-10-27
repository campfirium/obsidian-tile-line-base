import type { Plugin } from 'obsidian';
import {
	buildCollapsedSummary,
	isCollapsedDataLine,
	parseCollapsedDataLine,
	parseLegacySummaryLine
} from '../table-view/collapsed/CollapsedFieldCodec';

const SUMMARY_SELECTOR = 'p, li';

export function registerCollapsedFieldPresenter(plugin: Plugin): void {
	plugin.registerMarkdownPostProcessor((element) => {
		const nodes = element.querySelectorAll(SUMMARY_SELECTOR);
		nodes.forEach((node) => {
			const text = node.textContent?.trim();
			if (!text) {
				return;
			}
			if (isCollapsedDataLine(text)) {
				const entries = parseCollapsedDataLine(text);
				const summary = buildCollapsedSummary(entries);
				node.classList.add('tlb-collapsed-line');
				node.setAttribute('data-tlb-collapsed-summary', summary);
				return;
			}
			const legacyEntries = parseLegacySummaryLine(text);
			if (legacyEntries.length > 0) {
				const summary = buildCollapsedSummary(legacyEntries);
				node.classList.add('tlb-collapsed-line');
				node.setAttribute('data-tlb-collapsed-summary', summary);
			}
		});
	});
}
