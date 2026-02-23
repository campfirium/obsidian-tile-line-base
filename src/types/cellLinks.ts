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

export interface CellTextSegment {
	kind: 'text';
	text: string;
}

export interface CellLinkSegment {
	kind: 'link';
	text: string;
	link: DetectedCellLink;
}

export type CellRenderableSegment = CellTextSegment | CellLinkSegment;
