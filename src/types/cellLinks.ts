export type DetectedCellLinkType = 'internal' | 'external';

export interface DetectedCellLink {
	type: DetectedCellLinkType;
	target: string;
	displayText: string;
	sourceText: string;
}

export interface CellLinkClickContext {
	link: DetectedCellLink;
	field: string | null;
	rowId: string | null;
	rawValue: string;
}
