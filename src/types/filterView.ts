export interface FilterViewDefinition {
	id: string;
	name: string;
	filterModel: any | null;
	columnState?: any[] | null;
	quickFilter?: string | null;
}

export interface FileFilterViewState {
	views: FilterViewDefinition[];
	activeViewId: string | null;
}
