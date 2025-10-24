import { ROW_ID_FIELD, type GridAdapter, type RowData } from '../grid/GridAdapter';
import { getLogger } from '../utils/logger';
import type { Schema } from './SchemaBuilder';

const logger = getLogger('table-view:focus');

export interface FocusManagerDeps {
	getSchema: () => Schema | null;
	getBlockCount: () => number;
	getVisibleRows: () => RowData[];
	getGridAdapter: () => GridAdapter | null;
}

export interface FocusRowOptions {
	retryCount?: number;
	retryDelay?: number;
}

interface PendingFocusRequest {
	rowIndex: number;
	field: string | null;
	maxRetries: number;
	retriesLeft: number;
	retryDelay: number;
	pendingVerification: boolean;
}

/**
 * 负责聚焦到指定行并在必要时重试，避免 TableView 内部维护定时器与状态�?
 */
export class FocusManager {
	private pendingRequest: PendingFocusRequest | null = null;
	private retryTimer: NodeJS.Timeout | null = null;

	constructor(private readonly deps: FocusManagerDeps) {}

	focusRow(rowIndex: number, field?: string | null, options?: FocusRowOptions): void {
		const schema = this.deps.getSchema();
		const blockCount = this.deps.getBlockCount();

		if (!schema) {
			logger.trace('[FocusDebug]', 'focusRow: missing schema', { rowIndex, field });
			return;
		}
		if (rowIndex < 0 || rowIndex >= blockCount) {
			logger.trace('[FocusDebug]', 'focusRow: index out of range', {
				rowIndex,
				field,
				blockCount
			});
			return;
		}

		const maxRetries = Math.max(1, options?.retryCount ?? 20);
		const retryDelay = Math.max(20, options?.retryDelay ?? 80);

		this.clearPendingFocus('replace-request');

		this.pendingRequest = {
			rowIndex,
			field: field ?? null,
			maxRetries,
			retriesLeft: maxRetries,
			retryDelay,
			pendingVerification: false
		};

		const visibleRows = this.deps.getVisibleRows();
		logger.trace('[FocusDebug]', 'focusRow: request registered', {
			rowIndex,
			field: field ?? null,
			maxRetries,
			retryDelay,
			visibleRowCount: visibleRows.length
		});

		this.scheduleFocusAttempt(0, 'initial');
	}

	handleGridModelUpdated(): void {
		if (!this.pendingRequest) {
			logger.trace('[FocusDebug]', 'handleGridModelUpdated: no pending request');
			return;
		}
		logger.trace('[FocusDebug]', 'handleGridModelUpdated: reschedule', {
			rowIndex: this.pendingRequest.rowIndex,
			field: this.pendingRequest.field ?? null,
			retriesLeft: this.pendingRequest.retriesLeft
		});
		this.scheduleFocusAttempt(0, 'model-updated');
	}

	clearPendingFocus(reason?: string): void {
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}

		if (this.pendingRequest) {
			logger.trace('[FocusDebug]', 'clearPendingFocus', {
				reason: reason ?? 'unknown',
				rowIndex: this.pendingRequest.rowIndex,
				field: this.pendingRequest.field ?? null
			});
		} else {
			logger.trace('[FocusDebug]', 'clearPendingFocus', {
				reason: reason ?? 'unknown',
				skipped: true
			});
		}

		this.pendingRequest = null;
	}

	dispose(): void {
		this.clearPendingFocus('dispose');
	}

	private scheduleFocusAttempt(delay: number, reason: string): void {
		const request = this.pendingRequest;
		if (!request) {
			logger.trace('[FocusDebug]', 'scheduleFocusAttempt: no pending request', { reason, delay });
			return;
		}

		const effectiveDelay = Math.max(0, delay);
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}

		logger.trace('[FocusDebug]', 'scheduleFocusAttempt', {
			reason,
			delay: effectiveDelay,
			rowIndex: request.rowIndex,
			field: request.field ?? null,
			retriesLeft: request.retriesLeft,
			pendingVerification: request.pendingVerification
		});

		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			this.attemptFocusOnPendingRow();
		}, effectiveDelay);
	}

	private attemptFocusOnPendingRow(): void {
		const request = this.pendingRequest;
		if (!request) {
			logger.trace('[FocusDebug]', 'attemptFocus: skipped (no request)');
			return;
		}

		const attemptIndex = request.maxRetries - request.retriesLeft + 1;
		const schema = this.deps.getSchema();
		const gridAdapter = this.deps.getGridAdapter();

		if (!gridAdapter || !schema) {
			logger.trace('[FocusDebug]', 'attemptFocus: grid/schema not ready', {
				rowIndex: request.rowIndex,
				field: request.field ?? null,
				attemptIndex,
				retriesLeft: request.retriesLeft
			});
			this.handleFocusRetry(request, 'grid-not-ready');
			return;
		}

		const fallbackField = schema.columnNames[0] ?? null;
		const targetField = request.field && request.field !== ROW_ID_FIELD ? request.field : fallbackField;
		const targetRowId = String(request.rowIndex);

		const adapter: any = gridAdapter;
		const api = adapter.gridApi;
		if (!api) {
			logger.trace('[FocusDebug]', 'attemptFocus: grid API unavailable', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex,
				retriesLeft: request.retriesLeft
			});
			this.handleFocusRetry(request, 'missing-api');
			return;
		}

		let targetNode: any = null;
		if (typeof api.getRowNode === 'function') {
			targetNode = api.getRowNode(targetRowId);
		}

		if (!targetNode && typeof api.forEachNodeAfterFilterAndSort === 'function') {
			api.forEachNodeAfterFilterAndSort((node: any) => {
				if (targetNode) {
					return;
				}
				const nodeId = String(node?.data?.[ROW_ID_FIELD] ?? '');
				if (nodeId === targetRowId) {
					targetNode = node;
				}
			});
		}

		if (!targetNode) {
			logger.trace('[FocusDebug]', 'attemptFocus: target node missing', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex,
				retriesLeft: request.retriesLeft
			});
			this.handleFocusRetry(request, 'node-missing');
			return;
		}

		const visibleRows = this.deps.getVisibleRows();
		const displayedIndex = typeof targetNode.rowIndex === 'number' ? targetNode.rowIndex : null;
		const effectiveIndex = displayedIndex ?? visibleRows.findIndex(
			(row) => String(row?.[ROW_ID_FIELD]) === targetRowId
		);

		if (effectiveIndex === -1 || effectiveIndex === null) {
			logger.trace('[FocusDebug]', 'attemptFocus: effective index not found', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex,
				retriesLeft: request.retriesLeft,
				visibleRowCount: visibleRows.length
			});
			this.handleFocusRetry(request, 'index-missing');
			return;
		}

		const focusedCell = typeof api.getFocusedCell === 'function' ? api.getFocusedCell() : null;
		const focusedColumnId = focusedCell?.column
			? (typeof focusedCell.column.getColId === 'function'
				? focusedCell.column.getColId()
				: typeof focusedCell.column.getId === 'function'
					? focusedCell.column.getId()
					: focusedCell.column.colId ?? null)
			: null;

		const hasFocus =
			focusedCell != null &&
			focusedCell.rowIndex === effectiveIndex &&
			(!targetField || focusedColumnId === targetField);

		if (request.pendingVerification) {
			if (hasFocus) {
				logger.trace('[FocusDebug]', 'attemptFocus: verification success', {
					rowIndex: request.rowIndex,
					field: targetField,
					attemptIndex
				});
				this.clearPendingFocus('verification-success');
				return;
			}
			logger.trace('[FocusDebug]', 'attemptFocus: verification failed', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex
			});
			request.pendingVerification = false;
			this.handleFocusRetry(request, 'verification-failed');
			return;
		}

		if (hasFocus) {
			logger.trace('[FocusDebug]', 'attemptFocus: already focused', {
				rowIndex: request.rowIndex,
				field: targetField,
				attemptIndex
			});
			this.clearPendingFocus('already-focused');
			return;
		}

		if (typeof targetNode.setSelected === 'function') {
			targetNode.setSelected(true, true);
		} else {
			gridAdapter.selectRow?.(request.rowIndex, { ensureVisible: true });
		}

		if (typeof api.ensureNodeVisible === 'function') {
			api.ensureNodeVisible(targetNode, 'middle');
		} else if (typeof api.ensureIndexVisible === 'function') {
			api.ensureIndexVisible(effectiveIndex, 'middle');
		}

		if (targetField && typeof api.setFocusedCell === 'function') {
			api.setFocusedCell(effectiveIndex, targetField);
		}

		logger.trace('[FocusDebug]', 'attemptFocus: issued focus command', {
			rowIndex: request.rowIndex,
			field: targetField,
			attemptIndex,
			retriesLeft: request.retriesLeft
		});

		request.pendingVerification = true;
		this.scheduleFocusAttempt(Math.max(30, Math.floor(request.retryDelay / 2)), 'verification-delay');
	}

	private handleFocusRetry(request: PendingFocusRequest, reason: string): void {
		if (!this.pendingRequest || request !== this.pendingRequest) {
			return;
		}

		if (request.pendingVerification) {
			request.pendingVerification = false;
		}

		if (request.retriesLeft <= 1) {
			logger.trace('[FocusDebug]', 'handleFocusRetry: exhausted', {
				reason,
				rowIndex: request.rowIndex,
				field: request.field ?? null
			});
			this.clearPendingFocus('exhausted');
			return;
		}

		request.retriesLeft -= 1;
		logger.trace('[FocusDebug]', 'handleFocusRetry: scheduling retry', {
			reason,
			rowIndex: request.rowIndex,
			field: request.field ?? null,
			retriesLeft: request.retriesLeft
		});
		this.scheduleFocusAttempt(request.retryDelay, `retry:${reason}`);
	}
}
