import { Notice } from 'obsidian';
import type { TableView } from '../../TableView';
import { t } from '../../i18n';
import { getAvailableColumns } from '../TableViewFilterPresenter';

export class KanbanLaneFieldRepair {
	private pendingBoardId: string | null = null;
	private lastNoticeBoardId: string | null = null;

	constructor(private readonly view: TableView) {}

	public reset(): void {
		this.pendingBoardId = null;
		this.lastNoticeBoardId = null;
	}

	public markMissing(boardId: string): void {
		this.pendingBoardId = boardId;
		if (this.lastNoticeBoardId === boardId) {
			return;
		}
		if (!this.hasLaneFieldPrerequisites()) {
			return;
		}
		this.lastNoticeBoardId = boardId;
		new Notice(t('kanbanView.toolbar.laneFieldMissingNotice'));
	}

	public clearPending(): void {
		this.pendingBoardId = null;
	}

	public getPendingBoardId(): string | null {
		return this.pendingBoardId;
	}

	public hasLaneFieldPrerequisites(): boolean {
		const schema = this.view.schema;
		if (!schema || !Array.isArray(schema.columnNames) || schema.columnNames.length === 0) {
			return false;
		}
		if (getAvailableColumns(this.view).length === 0) {
			return false;
		}
		return this.getLaneFieldCandidates().length > 0;
	}

	public isLaneFieldAvailable(field: string): boolean {
		const trimmed = typeof field === 'string' ? field.trim() : '';
		if (!trimmed) {
			return false;
		}
		return this.getLaneFieldCandidates().includes(trimmed);
	}

	public getLaneFieldCandidates(): string[] {
		const schema = this.view.schema;
		if (!schema || !Array.isArray(schema.columnNames)) {
			return [];
		}
		return schema.columnNames.filter((name) => {
			if (!name || typeof name !== 'string') {
				return false;
			}
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return false;
			}
			return trimmed !== '#' && trimmed !== '__tlb_row_id';
		});
	}
}
