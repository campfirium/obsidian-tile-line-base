/**
 * AgGridAdapter - AG Grid Community 适配器实现
 *
 * 使用 AG Grid Community 实现 GridAdapter 接口。
 */

import {
	createGrid,
	GridApi,
	GridOptions,
	ColDef,
	CellEditingStoppedEvent,
	CellEditingStartedEvent,
	CellFocusedEvent,
	CellKeyDownEvent,
	CellDoubleClickedEvent,
	ModuleRegistry,
	AllCommunityModule,
	IRowNode,
	Column,
	ColumnResizedEvent,
	ColumnState,
	ColumnMovedEvent
} from 'ag-grid-community';
import {
	GridAdapter,
	ColumnDef,
	RowData,
	CellEditEvent,
	HeaderEditEvent,
	ROW_ID_FIELD,
	SortModelEntry
} from './GridAdapter';
import {
	StatusCellRenderer,
	TaskStatus,
	normalizeStatus,
	getStatusLabel,
	getStatusIcon
} from '../renderers/StatusCellRenderer';
import { createTextCellEditor } from './editors/TextCellEditor';
import { CompositionProxy } from './utils/CompositionProxy';
import { COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH, clampColumnWidth } from './columnSizing';
import { IconHeaderComponent } from './headers/IconHeaderComponent';

const DEFAULT_ROW_HEIGHT = 40;

// 注册 AG Grid Community 模块
ModuleRegistry.registerModules([AllCommunityModule]);

export class AgGridAdapter implements GridAdapter {
	private gridApi: GridApi | null = null;
	private cellEditCallback?: (event: CellEditEvent) => void;
	private headerEditCallback?: (event: HeaderEditEvent) => void;
	private columnHeaderContextMenuCallback?: (event: { field: string; domEvent: MouseEvent }) => void;
	private enterAtLastRowCallback?: (field: string) => void;
	private columnResizeCallback?: (field: string, width: number) => void;
	private columnOrderChangeCallback?: (fields: string[]) => void;
	private columnLayoutInitialized = false;
	private pendingEnterAtLastRow = false;
	private gridContext?: {
		onStatusChange?: (rowId: string, newStatus: TaskStatus) => void;
		onColumnResize?: (field: string, width: number) => void;
		onCopyH2Section?: (rowIndex: number) => void;
		onColumnOrderChange?: (fields: string[]) => void;
	};

	// Composition Proxy：每个 Document 一个代理层
	private proxyByDoc = new WeakMap<Document, CompositionProxy>();
	private containerEl: HTMLElement | null = null;
	private focusedDoc: Document | null = null;
	private focusedRowIndex: number | null = null;
	private focusedColId: string | null = null;
	private pendingCaptureCancel?: (reason?: string) => void;
	private editing = false;
	private columnApi: any = null;
	private ready = false;
	private readyCallbacks: Array<() => void> = [];
	private modelUpdatedCallbacks: Array<() => void> = [];
	private proxyRealignTimer: number | null = null;
	private viewportListenerCleanup: (() => void) | null = null;
	private quickFilterText: string = '';

	/**
	 * 获取或创建指定 Document 的 CompositionProxy
	 */
	private getProxy(doc: Document): CompositionProxy {
		let proxy = this.proxyByDoc.get(doc);
		if (!proxy) {
			proxy = new CompositionProxy(doc);
			this.proxyByDoc.set(doc, proxy);
		}
		return proxy;
	}

	/**
	 * 判断是否为可打印字符
	 */
	private isPrintable(e: KeyboardEvent): boolean {
		return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
	}


	private startEditingWithCapturedText(doc: Document, rowIndex: number, colKey: string, text: string): Promise<void> {
		if (!this.gridApi) {
			return Promise.resolve();
		}

		this.editing = true;
		this.focusedRowIndex = rowIndex;
		this.focusedColId = colKey;
		this.cancelPendingCapture('editing-started');
		this.getProxy(doc).setKeyHandler(undefined);

		this.gridApi.setFocusedCell(rowIndex, colKey);
		this.gridApi.startEditingCell({ rowIndex, colKey });

		return this.waitForEditorInput(doc)
			.then((input) => {
				input.value = text ?? '';
				const len = input.value.length;
				input.setSelectionRange(len, len);
				input.focus();
			})
			.catch((err) => {
				console.warn('[AgGridAdapter] 未找到编辑器输入框', err);
			});
	}

	private waitForEditorInput(doc: Document): Promise<HTMLInputElement | HTMLTextAreaElement> {
		const selector = '.ag-cell-editor input, .ag-cell-editor textarea, .ag-cell-inline-editing input, .ag-cell-inline-editing textarea, .ag-cell-edit-input';
		return new Promise((resolve, reject) => {
			const lookup = () => doc.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
			const immediate = lookup();
			if (immediate) {
				resolve(immediate);
				return;
			}

			const body = doc.body;
			if (!body) {
				reject(new Error('document.body 不可用'));
				return;
			}

			const observer = new MutationObserver(() => {
				const candidate = lookup();
				if (candidate) {
					cleanup();
					resolve(candidate);
				}
			});

			const timeout = window.setTimeout(() => {
				cleanup();
				reject(new Error('等待编辑器超时'));
			}, 1000);

			const cleanup = () => {
				window.clearTimeout(timeout);
				observer.disconnect();
			};

			observer.observe(body, { childList: true, subtree: true });
		});
	}

	private cancelPendingCapture(reason?: string): void {
		if (this.pendingCaptureCancel) {
			const cancel = this.pendingCaptureCancel;
			this.pendingCaptureCancel = undefined;
			cancel(reason);
		} else if (this.focusedDoc) {
			this.getProxy(this.focusedDoc).cancel(reason);
		}
	}

	private emitModelUpdated(): void {
		if (this.modelUpdatedCallbacks.length === 0) {
			return;
		}
		for (const callback of this.modelUpdatedCallbacks) {
			try {
				callback();
			} catch (error) {
				console.error('[AgGridAdapter] onModelUpdated callback failed', error);
			}
		}
	}

	runWhenReady(callback: () => void): void {
		if (this.ready) {
			callback();
			return;
		}
		this.readyCallbacks.push(callback);
	}

	onModelUpdated(callback: () => void): void {
		this.modelUpdatedCallbacks.push(callback);
	}

	private requestProxyRealign(reason: string): void {
		if (this.editing) {
			return;
		}

		this.cancelPendingCapture(reason);
		if (this.proxyRealignTimer != null) {
			window.clearTimeout(this.proxyRealignTimer);
		}

		this.proxyRealignTimer = window.setTimeout(() => {
			this.proxyRealignTimer = null;
			this.armProxyForCurrentCell();
		}, 80);
	}

	private bindViewportListeners(container: HTMLElement): void {
		this.unbindViewportListeners();

		const onScroll = () => this.requestProxyRealign('scroll');
		const onWheel = () => this.requestProxyRealign('scroll');
		const ownerWin = container.ownerDocument?.defaultView ?? window;
		const onResize = () => this.requestProxyRealign('resize');

		const viewports = Array.from(
			container.querySelectorAll<HTMLElement>(
				'.ag-center-cols-viewport, .ag-pinned-left-cols-viewport, .ag-pinned-right-cols-viewport, .ag-body-viewport'
			)
		);
		if (!viewports.includes(container)) {
			viewports.push(container);
		}

		const removers: Array<() => void> = [];
		const attach = (el: EventTarget, type: string, handler: EventListenerOrEventListenerObject, options?: boolean) => {
			el.addEventListener(type, handler, options);
			removers.push(() => el.removeEventListener(type, handler, options));
		};

		for (const viewport of viewports) {
			attach(viewport, 'scroll', onScroll, false);
			attach(viewport, 'wheel', onWheel, true);
		}
		attach(ownerWin, 'resize', onResize, false);

		this.viewportListenerCleanup = () => {
			for (const remove of removers) {
				remove();
			}
		};
	}

	private unbindViewportListeners(): void {
		if (this.viewportListenerCleanup) {
			this.viewportListenerCleanup();
			this.viewportListenerCleanup = null;
		}
	}

	private getCellElementFor(rowIndex: number, colKey: string, doc: Document): HTMLElement | null {
		const root = (this.containerEl ?? doc) as Document | Element;
		const column = this.gridApi?.getColumn(colKey);
		const pinned = column?.getPinned?.() ?? column?.isPinned?.();

		const containers: string[] = [];
		if (pinned === 'left') {
			containers.push('.ag-pinned-left-cols-container');
		} else if (pinned === 'right') {
			containers.push('.ag-pinned-right-cols-container');
		}
		containers.push('.ag-center-cols-container');

		for (const container of containers) {
			const selector = `${container} [row-index="${rowIndex}"] [col-id="${colKey}"]`;
			const match = (root as any).querySelector?.(selector) as HTMLElement | null;
			if (match) {
				return match;
			}
		}

		// 兜底：搜索所有 pinned 容器，防止 pinned 状态变更时遗漏
		const fallbackContainers = ['.ag-pinned-left-cols-container', '.ag-pinned-right-cols-container'];
		for (const container of fallbackContainers) {
			const selector = `${container} [row-index="${rowIndex}"] [col-id="${colKey}"]`;
			const match = (root as any).querySelector?.(selector) as HTMLElement | null;
			if (match) {
				return match;
			}
		}

		return null;
	}

	private armProxyForCurrentCell(): void {
		if (!this.gridApi) return;
		if (this.editing) return;
		if (this.focusedDoc == null || this.focusedRowIndex == null || !this.focusedColId) {
			this.cancelPendingCapture('focus-cleared');
			return;
		}

		const doc = this.focusedDoc;
		const rowIndex = this.focusedRowIndex;
		const colKey = this.focusedColId;
		const cellEl = this.getCellElementFor(rowIndex, colKey, doc);
		if (!cellEl) {
			this.cancelPendingCapture('cell-missing');
			return;
		}

		const rect = cellEl.getBoundingClientRect();
		const proxy = this.getProxy(doc);

		this.cancelPendingCapture('rearm');
		const capturePromise = proxy.captureOnceAt(rect);
		proxy.setKeyHandler((event) => this.handleProxyKeyDown(event));
		this.pendingCaptureCancel = (reason?: string) => proxy.cancel(reason);

		capturePromise
			.then((text) => {
				this.pendingCaptureCancel = undefined;
				if (this.editing) return;
				if (this.focusedRowIndex == null || !this.focusedColId) return;
				return this.startEditingWithCapturedText(doc, this.focusedRowIndex, this.focusedColId, text);
			})
			.catch((err) => {
				this.pendingCaptureCancel = undefined;
				if (err === 'cancelled' || err === 'rearm' || err === 'editing-started' || err === 'focus-cleared' || err === 'cell-missing' || err === 'destroyed' || err === 'focus-move') {
					return;
				}
				console.error('[AgGridAdapter] CompositionProxy 捕获失败', err);
			});
	}

	private handleProxyKeyDown(event: KeyboardEvent): void {
		if (!this.gridApi) return;

		if (this.isPrintable(event)) {
			return;
		}

		if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
			this.handleCopyShortcut(event);
			return;
		}

		switch (event.key) {
			case 'Enter':
				event.preventDefault();
				event.stopPropagation();
				this.handleProxyEnter(event.shiftKey);
				break;
			case 'Tab':
				event.preventDefault();
				event.stopPropagation();
				if (event.shiftKey) {
					this.moveFocus(0, -1);
				} else {
					this.moveFocus(0, 1);
				}
				break;
			case 'ArrowUp':
			case 'Up':
				event.preventDefault();
				event.stopPropagation();
				this.moveFocus(-1, 0);
				break;
			case 'ArrowDown':
			case 'Down':
				event.preventDefault();
				event.stopPropagation();
				this.moveFocus(1, 0);
				break;
			case 'ArrowLeft':
			case 'Left':
				event.preventDefault();
				event.stopPropagation();
				this.moveFocus(0, -1);
				break;
			case 'ArrowRight':
			case 'Right':
				event.preventDefault();
				event.stopPropagation();
				this.moveFocus(0, 1);
				break;
			case 'Delete':
			case 'Backspace':
				event.preventDefault();
				event.stopPropagation();
				this.handleDeleteKey();
				break;
			default:
				break;
		}
	}

	private handleCopyShortcut(event: KeyboardEvent): void {
		if (!this.gridApi) {
			return;
		}

		// 检查是否在序号列上
		const focusedCell = this.gridApi.getFocusedCell();
		if (focusedCell) {
			const colId = focusedCell.column.getColId();

			if (colId === '#') {
				const rowNode = this.gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
				if (rowNode) {
					const rowData = rowNode.data as RowData | undefined;
					if (rowData) {
						const blockIndex = parseInt(String(rowData[ROW_ID_FIELD]), 10);

						if (!isNaN(blockIndex) && this.gridContext?.onCopyH2Section) {
							event.preventDefault();
							event.stopPropagation();
							this.gridContext.onCopyH2Section(blockIndex);
							return;
						}
					}
				}
			}
		}

		// 默认行为：复制单元格文本
		const text = this.extractFocusedCellText();
		if (text == null) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const doc = this.focusedDoc || document;
		this.copyTextToClipboard(doc, text);
	}

	private extractFocusedCellText(): string | null {
		if (!this.gridApi) return null;

		const focusedCell = this.gridApi.getFocusedCell();
		if (!focusedCell) return null;

		const rowNode = this.gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		if (!rowNode) return null;

		const colId = focusedCell.column.getColId();
		const field = focusedCell.column.getColDef().field ?? colId;
		const rowData = rowNode.data as RowData | undefined;
		const raw = rowData ? (rowData[field] ?? rowData[colId]) : undefined;
		return raw == null ? '' : String(raw);
	}

	private copyTextToClipboard(doc: Document, text: string): void {
		const nav = doc.defaultView?.navigator;
		if (nav?.clipboard?.writeText) {
			nav.clipboard.writeText(text).catch(() => {
				this.copyViaHiddenTextarea(doc, text);
			});
			return;
		}

		this.copyViaHiddenTextarea(doc, text);
	}

	private copyViaHiddenTextarea(doc: Document, text: string): void {
		const textarea = doc.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', 'true');
		Object.assign(textarea.style, {
			position: 'fixed',
			left: '-9999px',
			top: '0',
			width: '1px',
			height: '1px',
			opacity: '0'
		});

		doc.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		try {
			doc.execCommand('copy');
		} catch (error) {
			console.warn('[AgGridAdapter] execCommand 复制失败', error);
		}
		textarea.blur();
		doc.body.removeChild(textarea);
	}

	getFilterModel(): any | null {
		if (!this.gridApi || typeof this.gridApi.getFilterModel !== 'function') {
			return null;
		}
		return this.deepClone(this.gridApi.getFilterModel());
	}

	setFilterModel(model: any | null): void {
		this.runWhenReady(() => {
			if (!this.gridApi || typeof this.gridApi.setFilterModel !== 'function') {
				return;
			}
			const cloned = model == null ? null : this.deepClone(model);
			this.gridApi.setFilterModel(cloned);
			if (typeof this.gridApi.onFilterChanged === 'function') {
				this.gridApi.onFilterChanged();
			}
		});
	}

	setSortModel(sortModel: SortModelEntry[]): void {
		this.runWhenReady(() => {
			if (!this.columnApi || typeof this.columnApi.applyColumnState !== 'function') {
				return;
			}
			const state = Array.isArray(sortModel)
				? sortModel
					.filter((item) => typeof item?.field === 'string' && item.field.length > 0)
					.map((item, index) => ({
						colId: item.field,
						sort: item.direction === 'desc' ? 'desc' : 'asc',
						sortIndex: index
					}))
				: [];
			this.columnApi.applyColumnState({
				defaultState: { sort: null, sortIndex: null },
				state
			});
			if (this.gridApi && typeof this.gridApi.refreshClientSideRowModel === 'function') {
				this.gridApi.refreshClientSideRowModel('sort');
			}
		});
	}

	setQuickFilter(value: string | null): void {
		this.quickFilterText = value?.trim() ?? '';
		this.runWhenReady(() => {
			this.applyQuickFilterText();
		});
	}

	getColumnState(): ColumnState[] | null {
		if (!this.columnApi || typeof this.columnApi.getColumnState !== 'function') {
			return null;
		}
		return this.cloneColumnState(this.columnApi.getColumnState());
	}

	applyColumnState(state: ColumnState[] | null): void {
		this.runWhenReady(() => {
			if (!this.columnApi || typeof this.columnApi.applyColumnState !== 'function') {
				return;
			}
			if (!state) {
				this.columnApi.resetColumnState();
				return;
			}
			this.columnApi.applyColumnState({
				state: this.cloneColumnState(state) ?? undefined,
				applyOrder: true
			});
			this.applyQuickFilterText();
		});
	}

	private cloneColumnState(state: ColumnState[] | null | undefined): ColumnState[] | null {
		if (!state) {
			return null;
		}
		return state.map((item) => ({ ...item }));
	}

	private deepClone<T>(value: T): T {
		if (value == null) {
			return value;
		}
		return JSON.parse(JSON.stringify(value)) as T;
	}

	private handleProxyEnter(shift: boolean): void {
		if (!this.gridApi) return;
		if (this.focusedRowIndex == null || !this.focusedColId) return;

		if (shift) {
			this.moveFocus(-1, 0);
			return;
		}

		const rowIndex = this.focusedRowIndex;
		const totalRows = this.gridApi.getDisplayedRowCount();
		if (totalRows === 0) return;
		const colId = this.focusedColId;

		if (rowIndex === totalRows - 1) {
			if (this.enterAtLastRowCallback) {
				this.enterAtLastRowCallback(colId);
			}
			return;
		}

		this.moveFocus(1, 0);
	}

	private handleDeleteKey(): void {
		if (!this.gridApi) return;

		// 直接使用 getFocusedCell 获取当前聚焦的单元格（支持过滤视图）
		const focusedCell = this.gridApi.getFocusedCell();
		if (!focusedCell) return;

		const field = focusedCell.column.getColId();
		if (field === '#' || field === ROW_ID_FIELD || field === 'status') {
			return;
		}

		// 使用 getDisplayedRowAtIndex 获取当前显示的行节点（支持过滤视图）
		const rowNode = this.gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		if (!rowNode) return;

		const data = rowNode.data as RowData | undefined;
		if (!data) return;

		const oldValue = String(data[field] ?? '');
		if (oldValue.length === 0) {
			return;
		}

		// 清空单元格内容
		if (typeof rowNode.setDataValue === 'function') {
			rowNode.setDataValue(field, '');
		} else {
			data[field] = '';
		}

		// 触发单元格编辑回调（需要使用 blockIndex）
		const raw = data[ROW_ID_FIELD];
		const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
		if (!Number.isNaN(blockIndex) && this.cellEditCallback) {
			this.cellEditCallback({
				rowIndex: blockIndex,
				field,
				newValue: '',
				oldValue,
				rowData: data
			});
		}

		this.armProxyForCurrentCell();
	}

	private moveFocus(rowDelta: number, colDelta: number): void {
		if (!this.gridApi) return;
		if (this.focusedRowIndex == null || !this.focusedColId) return;

		const displayedColumns = this.gridApi.getAllDisplayedColumns();
		if (!displayedColumns || displayedColumns.length === 0) return;

		const currentColIndex = displayedColumns.findIndex(col => col.getColId() === this.focusedColId);
		if (currentColIndex === -1) return;

		const targetColIndex = Math.max(0, Math.min(displayedColumns.length - 1, currentColIndex + colDelta));
		const targetCol = displayedColumns[targetColIndex];

		const rowCount = this.gridApi.getDisplayedRowCount();
		if (rowCount === 0) return;
		const targetRowIndex = Math.max(0, Math.min(rowCount - 1, this.focusedRowIndex + rowDelta));

		this.cancelPendingCapture('focus-move');
		this.gridApi.ensureIndexVisible(targetRowIndex);
		this.gridApi.setFocusedCell(targetRowIndex, targetCol.getColId());
		this.focusedRowIndex = targetRowIndex;
		this.focusedColId = targetCol.getColId();
		this.armProxyForCurrentCell();
	}

	private handleCellFocused(event: CellFocusedEvent): void {
		this.focusedDoc = this.containerEl?.ownerDocument || document;

		if (event.rowIndex == null || !event.column) {
			this.focusedRowIndex = null;
			this.focusedColId = null;
			this.cancelPendingCapture('focus-cleared');
			return;
		}

		this.focusedRowIndex = event.rowIndex;
		const colId = (event as any).column?.getColId?.() ?? (event as any).columnId ?? null;
		this.focusedColId = colId;

		if (this.editing) {
			return;
		}

		this.armProxyForCurrentCell();
	}

	private handleCellEditingStarted(): void {
		this.editing = true;
		this.cancelPendingCapture('editing-started');
		if (this.focusedDoc) {
			this.getProxy(this.focusedDoc).setKeyHandler(undefined);
		}
	}

	/**
	 * 挂载表格到指定容器
	 */
	mount(
		container: HTMLElement,
		columns: ColumnDef[],
		rows: RowData[],
		context?: {
			onStatusChange?: (rowId: string, newStatus: TaskStatus) => void;
			onColumnResize?: (field: string, width: number) => void;
			onCopyH2Section?: (rowIndex: number) => void;
			onColumnOrderChange?: (fields: string[]) => void;
		}
	): void {
		this.containerEl = container;
		this.focusedDoc = container.ownerDocument || document;
		this.gridContext = context;
		this.columnResizeCallback = context?.onColumnResize;
		this.columnOrderChangeCallback = context?.onColumnOrderChange;
		this.columnLayoutInitialized = false;
		if (this.proxyRealignTimer != null) {
			window.clearTimeout(this.proxyRealignTimer);
			this.proxyRealignTimer = null;
		}
		this.unbindViewportListeners();

		// 转换列定义为 AG Grid 格式
		const colDefs: ColDef[] = columns.map(col => {
			// 序号列特殊处理
			if (col.field === '#') {
				return {
					field: col.field,
					headerName: col.headerName,
					editable: false,
					pinned: 'left',
					lockPinned: true,
					lockPosition: true,
					suppressMovable: true,
					width: 60,  // 固定宽度
					maxWidth: 80,
					sortable: true,
					filter: false,
					resizable: false,
					suppressSizeToFit: true,  // 不参与自动调整
					cellStyle: { textAlign: 'center' },  // 居中显示
					headerComponent: IconHeaderComponent,
					headerComponentParams: {
						icon: 'hashtag',
						fallbacks: ['hash'],
						tooltip: col.headerTooltip || col.headerName || 'Index'
					}
				};
			}

			// status 列特殊处理
			if (col.field === 'status') {
				const headerName = col.headerName ?? 'Status';
				const tooltipFallback =
					typeof headerName === 'string' && headerName.trim().length > 0
						? headerName
						: 'Status';

				return {
					field: col.field,
					headerName,
					headerTooltip: col.headerTooltip ?? tooltipFallback,
					editable: false,  // 禁用编辑模式
					pinned: 'left',
					lockPinned: true,
					lockPosition: true,
					suppressMovable: true,
					width: 60,  // 固定宽度
					resizable: false,
					sortable: true,
					filter: false,
					suppressSizeToFit: true,  // 不参与自动调整
					suppressNavigable: true,  // 禁止键盘导航
					cellRenderer: StatusCellRenderer,  // 使用自定义渲染器
					cellStyle: {
						textAlign: 'center',
						cursor: 'pointer',
						padding: '10px var(--ag-cell-horizontal-padding)'  // 使用计算后的垂直内边距 (8px + 2px，来自行距调整)
					},
					headerComponent: IconHeaderComponent,
					headerComponentParams: {
						icon: 'list-checks',
						fallbacks: ['checklist', 'check-square'],
						tooltip: col.headerTooltip ?? tooltipFallback
					}
				};
			}

			// 构建基础列定义
			const baseColDef: ColDef = {
				field: col.field,
				headerName: col.headerName,
				editable: col.editable,
				sortable: true, // 启用排序
				filter: false, // 关闭筛选
				resizable: true, // 可调整列宽
				cellClass: 'tlb-cell-truncate'
			};

			// 合并用户配置（width, flex 等）
			const mergedColDef = { ...baseColDef, ...(col as any) };
			if (typeof col.field === 'string' && col.field !== '#' && col.field !== 'status') {
				mergedColDef.minWidth = typeof mergedColDef.minWidth === 'number'
					? clampColumnWidth(mergedColDef.minWidth)
					: COLUMN_MIN_WIDTH;
				mergedColDef.maxWidth = typeof mergedColDef.maxWidth === 'number'
					? clampColumnWidth(mergedColDef.maxWidth)
					: COLUMN_MAX_WIDTH;
			}
			const pinnedFields = new Set(['任务', '任务名称', '任务', 'task', 'taskName', 'title', '标题']);
			if (typeof col.field === 'string' && pinnedFields.has(col.field)) {
				mergedColDef.pinned = 'left';
				mergedColDef.lockPinned = true;
			}

			const explicitWidth = (mergedColDef as any).width;
			if (typeof explicitWidth === 'number') {
				const clamped = clampColumnWidth(explicitWidth);
				(mergedColDef as any).width = clamped;
				(mergedColDef as any).suppressSizeToFit = true;
			}

			return mergedColDef;
		});

		const statusColDef = colDefs.find(def => def.field === 'status');
		if (statusColDef) {
			statusColDef.width = 80;
			statusColDef.minWidth = 72;
			statusColDef.maxWidth = 96;
		}

		// 获取容器所在的 document 和 body（支持 pop-out 窗口）
		const ownerDoc = container.ownerDocument;
		const popupParent = ownerDoc.body;

		// 创建 AG Grid 配置
		const gridOptions: GridOptions = {
			onGridReady: (params: any) => {
				this.gridApi = params.api;
				this.columnApi = params.columnApi ?? null;
				this.ready = true;
				if (this.readyCallbacks.length > 0) {
					const queue = [...this.readyCallbacks];
					this.readyCallbacks.length = 0;
					for (const callback of queue) {
						try {
							callback();
						} catch (error) {
							console.error('[AgGridAdapter] runWhenReady callback failed', error);
						}
					}
				}
			},
			columnDefs: colDefs,
			rowData: rows,
			rowHeight: DEFAULT_ROW_HEIGHT,
			onFirstDataRendered: () => {
				this.resizeColumns();
			},
			onModelUpdated: () => {
				this.emitModelUpdated();
			},
			onRowDataUpdated: () => {
				this.emitModelUpdated();
			},

		// 提供稳定的行 ID（用于增量更新和状态管理）
		getRowId: (params) => {
				return String(params.data[ROW_ID_FIELD]);
			},

			// 传递上下文（包含回调函数）
			context: context || {},
			enableBrowserTooltips: true,
			tooltipShowDelay: 0,
			tooltipHideDelay: 200,
			onCellKeyDown: (event: CellKeyDownEvent) => {
				const keyEvent = event.event;

				if (!(keyEvent instanceof KeyboardEvent)) {
					return;
				}

				// 处理序号列的 Ctrl+C 复制整段
				// 注意：此代码不会被触发，因为 Ctrl+C 在 CompositionProxy 层就被拦截了
				// 保留此代码作为备用处理逻辑
				if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key === 'c') {
					const colId = event.column?.getColId?.() ?? null;

					if (colId === '#') {
						const rowData = event.node?.data as RowData | undefined;
						if (rowData) {
							const blockIndex = parseInt(String(rowData[ROW_ID_FIELD]), 10);

							if (!isNaN(blockIndex) && context?.onCopyH2Section) {
								keyEvent.preventDefault();
								keyEvent.stopPropagation();
								context.onCopyH2Section(blockIndex);
								return;
							}
						}
					}
				}

				this.handleEnterAtLastRow(
					event.api,
					event.column?.getColId?.() ?? null,
					event.node?.rowIndex ?? null,
					keyEvent
				);
			},

			// 设置弹出元素的父容器（支持 pop-out 窗口）

			// 编辑配置（使用单元格编辑模式而非整行编辑）
			singleClickEdit: false, // 禁用单击编辑，双击或按键可以进入编辑
			stopEditingWhenCellsLoseFocus: true, // 失焦时停止编辑

			// Enter 键导航配置（Excel 风格）
			enterNavigatesVertically: true, // Enter 键垂直导航
			enterNavigatesVerticallyAfterEdit: true, // 编辑后 Enter 垂直导航

			// 行选择配置（支持多行选择，Shift+点击范围选择，Ctrl+点击多选）
			rowSelection: {
				mode: 'multiRow',
				enableClickSelection: true,
				enableSelectionWithoutKeys: false,
				checkboxes: false,
				checkboxLocation: 'autoGroupColumn'
			},
			selectionColumnDef: {
				width: 0,
				minWidth: 0,
				maxWidth: 0,
				resizable: false,
				suppressSizeToFit: true,
				headerName: '',
				suppressHeaderMenuButton: true,
				suppressHeaderContextMenu: true
			},

			// 事件监听
			onCellEditingStopped: (event: CellEditingStoppedEvent) => {
				this.handleCellEdit(event);
			},
			onCellEditingStarted: (_event: CellEditingStartedEvent) => {
				this.handleCellEditingStarted();
			},
			onCellFocused: (event: CellFocusedEvent) => {
				this.handleCellFocused(event);
			},
			onColumnResized: (event: ColumnResizedEvent) => {
				this.handleColumnResized(event);
			},
			onColumnMoved: (event: ColumnMovedEvent) => {
				this.handleColumnMoved(event);
			},
			onCellDoubleClicked: (event: CellDoubleClickedEvent) => {
				const colId = event.column?.getColId?.() ?? null;
				if (colId !== '#') {
					return;
				}
				const data = event.data as RowData | undefined;
				const raw = data ? data[ROW_ID_FIELD] : undefined;
				const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
				if (Number.isNaN(blockIndex)) {
					return;
				}
				this.gridContext?.onCopyH2Section?.(blockIndex);
			},
			onColumnHeaderContextMenu: (params: any) => {
				const column = params?.column ?? null;
				const field = column && typeof column.getColId === 'function' ? column.getColId() : null;
				const domEvent = (params?.event ?? params?.mouseEvent) as MouseEvent | undefined;
				if (!field || !domEvent) {
					return;
				}
				if (this.columnHeaderContextMenuCallback) {
					this.columnHeaderContextMenuCallback({ field, domEvent });
				}
			},

			// 默认列配置
			defaultColDef: {
				tooltipValueGetter: (params) => {
					const value = params.value;
					return value == null ? '' : String(value);
				},
				editable: true,
				sortable: true,
				filter: false,
				resizable: true,
				cellEditor: createTextCellEditor(), // 🔑 使用工厂函数创建编辑器，支持 pop-out 窗口
				suppressKeyboardEvent: (params: any) => {
					const keyEvent = params.event as KeyboardEvent;
					return this.handleEnterAtLastRow(
						params.api,
						params.column?.getColId?.() ?? null,
						params.node?.rowIndex ?? null,
						keyEvent
					);
				}
			},

			// 启用单元格复制粘贴
			enableCellTextSelection: true,

			// 性能优化：减少不必要的重绘
			suppressAnimationFrame: false,  // 保留动画帧以提升流畅度
			suppressColumnVirtualisation: false,  // 保留列虚拟化以提升性能

			// 行样式规则：done 和 canceled 状态的行半透明
			rowClassRules: {
				'tlb-row-completed': (params) => {
					const status = normalizeStatus(params.data?.status);
					return status === 'done' || status === 'canceled';
				}
			},

			// 单元格样式规则：标题列添加删除线（假设第一个数据列是标题列）
			// 注意：这里需要动态获取标题列的 colId
			// 暂时使用通用选择器，后续在 TableView 中根据实际列名配置
		};

		// 创建并挂载 AG Grid
		this.gridApi = createGrid(container, gridOptions);
		this.bindViewportListeners(container);

		['ag-Grid-SelectionColumn', 'ag-Grid-AutoColumn'].forEach((colId) => {
			if (this.gridApi?.getColumn(colId)) {
				this.gridApi.setColumnsVisible([colId], false);
			}
		});

		// 对短文本列执行一次性 autoSize（不会随窗口变化重复执行）
		setTimeout(() => {
					}, 100);
	}

	/**
	 * 判断是否为长文本列
	 * 策略：扫描该列所有数据，计算最大内容长度
	 */

	private handleCellEdit(event: CellEditingStoppedEvent): void {
		this.editing = false;
		this.armProxyForCurrentCell();

		if (!this.cellEditCallback) return;

		// 获取编辑信息
		const field = event.colDef.field;
		const rowIndex = event.node.rowIndex;
		const newValue = event.newValue;
		const oldValue = event.oldValue;

		if (field && rowIndex !== null && rowIndex !== undefined) {
			// 规范化值（undefined、null、空字符串 都转为空字符串）
			const newStr = String(newValue ?? '');
			const oldStr = String(oldValue ?? '');

			// 只有当值真正改变时才触发回调
			if (newStr !== oldStr) {
				this.cellEditCallback({
					rowIndex: rowIndex,
					field: field,
					newValue: newStr,
					oldValue: oldStr,
					rowData: event.data as RowData
				});
			}
		}

	}

	/**
	 * 更新表格数据
	 */
	updateData(rows: RowData[]): void {
		if (this.gridApi) {
			this.gridApi.setGridOption('rowData', rows);
			this.gridApi.refreshCells({ force: true });
		}
	}

	private handleEnterAtLastRow(
		api: GridApi,
		columnId: string | null | undefined,
		rowIndex: number | null | undefined,
		keyEvent: KeyboardEvent
	): boolean {
		if (keyEvent.key !== 'Enter') {
			return false;
		}

		if (!this.enterAtLastRowCallback) {
			return false;
		}

		const editingCells = typeof api.getEditingCells === 'function' ? api.getEditingCells() : [];
		const activeEditingCell = editingCells.length > 0 ? editingCells[0] : undefined;
		const focusedCell = api.getFocusedCell();

		const effectiveRowIndex =
			(rowIndex ?? undefined) ??
			(activeEditingCell?.rowIndex ?? undefined) ??
			(focusedCell?.rowIndex ?? undefined) ??
			this.focusedRowIndex ??
			null;

		if (effectiveRowIndex == null || effectiveRowIndex < 0) {
			return false;
		}

		const totalRows = api.getDisplayedRowCount();
		if (totalRows <= 0 || effectiveRowIndex !== totalRows - 1) {
			return false;
		}

		keyEvent.preventDefault();

		if (this.pendingEnterAtLastRow) {
			return true;
		}
		this.pendingEnterAtLastRow = true;

		const resolvedColId =
			columnId ??
			activeEditingCell?.column?.getColId?.() ??
			focusedCell?.column.getColId() ??
			this.focusedColId ??
			null;

		const fallbackColId = (() => {
			if (!this.gridApi) {
				return null;
			}
			const displayed = typeof this.gridApi.getAllDisplayedColumns === 'function'
				? this.gridApi.getAllDisplayedColumns()
				: [];
			for (const col of displayed) {
				const field = col.getColDef().field;
				if (field && field !== '#') {
					return col.getColId?.() ?? field;
				}
			}
			return null;
		})();

		const nextColId = resolvedColId ?? fallbackColId ?? '#';

		setTimeout(() => {
			if (typeof api.stopEditing === 'function') {
				api.stopEditing();
			}
			setTimeout(() => {
				try {
					this.enterAtLastRowCallback?.(nextColId);
				} finally {
					this.pendingEnterAtLastRow = false;
				}
			}, 10);
		}, 0);

		return true;
	}

	markLayoutDirty(): void {
		this.columnLayoutInitialized = false;
		this.armProxyForCurrentCell();
	}

	selectRow(blockIndex: number, options?: { ensureVisible?: boolean }): void {
		if (!this.gridApi) return;
		const node = this.findRowNodeByBlockIndex(blockIndex);
		if (!node) return;

		this.gridApi.deselectAll();
		node.setSelected(true, true);

		if (options?.ensureVisible !== false) {
			const rowIndex = node.rowIndex ?? null;
			if (rowIndex !== null) {
				this.gridApi.ensureIndexVisible(rowIndex, 'middle');
			}
		}
	}

	/**
	 * 监听单元格编辑事件
	 */
	onCellEdit(callback: (event: CellEditEvent) => void): void {
		this.cellEditCallback = callback;
	}

	/**
	 * 监听表头编辑事件
	 *
	 * 注意：AG Grid 默认不支持表头编辑。
	 * 这里提供接口，但暂时不实现。
	 * 如果需要表头编辑功能，可以通过自定义 Header Component 实现。
	 */
onHeaderEdit(callback: (event: HeaderEditEvent) => void): void {
	this.headerEditCallback = callback;
	// TODO: 实现表头编辑（需要自定义 Header Component）
}

onColumnHeaderContextMenu(callback: (event: { field: string; domEvent: MouseEvent }) => void): void {
	this.columnHeaderContextMenuCallback = callback;
}

	/**
	 * 销毁表格实例
	 */
	destroy(): void {
		if (this.gridApi) {
			this.gridApi.destroy();
			this.gridApi = null;
		}
		this.ready = false;
		this.readyCallbacks = [];
		this.modelUpdatedCallbacks = [];
		this.columnApi = null;
		this.cancelPendingCapture('destroy');
		if (this.proxyRealignTimer != null) {
			window.clearTimeout(this.proxyRealignTimer);
			this.proxyRealignTimer = null;
		}
		this.unbindViewportListeners();
		this.columnResizeCallback = undefined;
		this.columnHeaderContextMenuCallback = undefined;
		this.columnOrderChangeCallback = undefined;
		this.columnLayoutInitialized = false;
		this.containerEl = null;
		this.focusedDoc = null;
	}

	/**
	 * 获取当前选中的块索引
	 */
	getSelectedRows(): number[] {
		if (!this.gridApi) return [];

		const selectedNodes = [...this.gridApi.getSelectedNodes()] as Array<IRowNode<RowData>>;
		const resolveSortKey = (node: IRowNode<RowData>): number => {
			const baseIndex = node.rowIndex ?? 0;
			if (node.rowPinned === 'top') {
				return baseIndex - 1_000_000_000;
			}
			if (node.rowPinned === 'bottom') {
				return baseIndex + 1_000_000_000;
			}
			return baseIndex;
		};
		selectedNodes.sort((a, b) => resolveSortKey(a) - resolveSortKey(b));
		const blockIndexes: number[] = [];

		for (const node of selectedNodes) {
			const data = node.data as RowData | undefined;
			if (!data) continue;
			const raw = data[ROW_ID_FIELD];
			const parsed = raw !== undefined ? parseInt(String(raw), 10) : NaN;
			if (!Number.isNaN(parsed)) {
				blockIndexes.push(parsed);
			}
		}

		return blockIndexes;
	}

	/**
	 * 根据鼠标事件获取块索引
	 * @param event 鼠标事件
	 * @returns 块索引，如果未找到则返回 null
	 */
	getRowIndexFromEvent(event: MouseEvent): number | null {
		if (!this.gridApi) return null;

		const target = event.target as HTMLElement;
		const rowElement = target.closest('.ag-row');

		if (!rowElement) return null;

		const rowIndexAttr = rowElement.getAttribute('row-index');
		if (rowIndexAttr === null) return null;

		const displayIndex = parseInt(rowIndexAttr, 10);
		if (Number.isNaN(displayIndex)) return null;

		const rowNode = this.gridApi.getDisplayedRowAtIndex(displayIndex);
		const data = rowNode?.data as RowData | undefined;
		if (!data) return null;

		const raw = data[ROW_ID_FIELD];
		const parsed = raw !== undefined ? parseInt(String(raw), 10) : NaN;
		return Number.isNaN(parsed) ? null : parsed;
	}

	/**
	 * 手动触发列宽调整
	 * 用于处理容器尺寸变化或新窗口初始化的情况
	 */
	resizeColumns(): void {
		if (!this.gridApi) {
			return;
		}

		if (!this.containerEl) {
			if (!this.columnLayoutInitialized) {
				this.initializeColumnSizing();
			}
			return;
		}

		const containerWidth = this.containerEl.clientWidth ?? 0;
		const containerHeight = this.containerEl.clientHeight ?? 0;
		if (containerWidth <= 0 || containerHeight <= 0) {
			return;
		}

		const gridApiAny = this.gridApi as any;
		gridApiAny?.doLayout?.();
		gridApiAny?.checkGridSize?.();

		const allColumns = this.gridApi.getAllDisplayedColumns() || [];

		if (!this.columnLayoutInitialized) {
			this.initializeColumnSizing();
			return;
		}

		this.applyWidthClamping(allColumns);
		this.distributeSparseSpace(allColumns);
		this.gridApi.refreshHeader();
		this.gridApi.refreshCells({ force: true });
	}

	private applyWidthClamping(columns: Column[]): void {
		if (!this.gridApi) return;

		for (const column of columns) {
			const colId = column.getColId();
			if (!colId || colId === '#' || colId === 'status') {
				continue;
			}

			const current = column.getActualWidth();
			const clamped = clampColumnWidth(current);
			if (Math.abs(clamped - current) > 0.5) {
				this.gridApi.setColumnWidths([{ key: colId, newWidth: clamped }]);
			}
		}
	}

	private distributeSparseSpace(columns: Column[]): void {
		if (!this.containerEl) {
			return;
		}

		const viewportWidth = this.containerEl.clientWidth ?? 0;
		if (viewportWidth <= 0) {
			return;
		}

		const totalWidth = columns.reduce((sum, column) => sum + column.getActualWidth(), 0);
		let deficit = viewportWidth - totalWidth;
		if (deficit <= 1) {
			return;
		}

		let adjustable = columns.filter((column) => {
			const id = column.getColId();
			return id && id !== '#' && id !== 'status' && column.isResizable();
		});

		if (adjustable.length === 0) {
			return;
		}

		const tolerance = 0.5;

		while (deficit > tolerance && adjustable.length > 0) {
			const share = deficit / adjustable.length;
			let consumed = 0;
			const nextRound: Column[] = [];

			for (const column of adjustable) {
				const current = column.getActualWidth();
				const target = clampColumnWidth(current + share);
				const delta = target - current;

				if (delta > tolerance) {
					const colId = column.getColId();
					if (colId) {
						this.gridApi!.setColumnWidths([{ key: colId, newWidth: target }]);
					}
					consumed += delta;
				}

				if (target < COLUMN_MAX_WIDTH - tolerance) {
					nextRound.push(column);
				}
			}

			if (consumed <= tolerance) {
				break;
			}

			deficit -= consumed;
			adjustable = nextRound.length > 0
				? nextRound
				: adjustable.filter((column) => column.getActualWidth() < COLUMN_MAX_WIDTH - tolerance);
		}
	}

	private initializeColumnSizing(): void {
		if (!this.gridApi || !this.containerEl) {
			return;
		}

		const containerWidth = this.containerEl.clientWidth ?? 0;
		const containerHeight = this.containerEl.clientHeight ?? 0;
		if (containerWidth <= 0 || containerHeight <= 0) {
			return;
		}

		const columns = this.gridApi.getAllDisplayedColumns() || [];
		if (columns.length === 0) {
			this.columnLayoutInitialized = true;
			return;
		}

		const storedWidths = new Map<string, number>();
		const explicitWidths = new Map<string, number>();
		let requiresAutoSize = false;

		for (const column of columns) {
			const colId = column.getColId();
			if (!colId || colId === '#' || colId === 'status') {
				continue;
			}

			const colDef = column.getColDef() as any;
			const stored = colDef.__tlbStoredWidth;
			const explicit = colDef.width;

			if (typeof stored === 'number') {
				storedWidths.set(colId, clampColumnWidth(stored));
			} else if (typeof explicit === 'number') {
				const clamped = clampColumnWidth(explicit);
				explicitWidths.set(colId, clamped);
				colDef.width = clamped;
				colDef.suppressSizeToFit = true;
			} else {
				requiresAutoSize = true;
			}
		}

		if (requiresAutoSize) {
			this.gridApi.autoSizeAllColumns();
		}

		for (const column of columns) {
			const colId = column.getColId();
			if (!colId || colId === '#' || colId === 'status') {
				continue;
			}

			const stored = storedWidths.get(colId);
			const explicit = explicitWidths.get(colId);

			if (stored !== undefined) {
				this.gridApi.setColumnWidths([{ key: colId, newWidth: stored }]);
				(column.getColDef() as any).__tlbStoredWidth = stored;
				continue;
			}

			if (explicit !== undefined) {
				this.gridApi.setColumnWidths([{ key: colId, newWidth: explicit }]);
				const colDef = column.getColDef() as any;
				colDef.width = explicit;
				colDef.suppressSizeToFit = true;
			}
		}

		this.applyWidthClamping(columns);
		this.distributeSparseSpace(columns);
		this.gridApi.refreshHeader();
		this.gridApi.refreshCells({ force: true });
		this.columnLayoutInitialized = true;
	}

	private handleColumnResized(event: ColumnResizedEvent): void {
		if (!event.finished || !event.column) {
			return;
		}

		const source = event.source as string | undefined;
		if (source !== 'uiColumnDragged' && source !== 'uiColumnResized') {
			return;
		}

		const colId = event.column.getColId();
		if (!colId || colId === '#' || colId === 'status') {
			return;
		}

		const clamped = clampColumnWidth(event.column.getActualWidth());
		if (Math.abs(clamped - event.column.getActualWidth()) > 0.5) {
			this.gridApi!.setColumnWidths([{ key: colId, newWidth: clamped }]);
		}

		const colDef = event.column.getColDef() as any;
		colDef.__tlbStoredWidth = clamped;

		if (this.columnResizeCallback) {
			this.columnResizeCallback(colId, clamped);
		}
	}

	private handleColumnMoved(event: ColumnMovedEvent): void {
		if (!this.columnOrderChangeCallback) {
			return;
		}

		if (!event.finished) {
			return;
		}

		const column = event.column ?? null;
		const columnId = typeof column?.getColId === 'function' ? column.getColId() : null;
		if (columnId === '#' || columnId === 'status' || columnId === ROW_ID_FIELD) {
			return;
		}

		const columnApi: any = this.columnApi;
		if (!columnApi || typeof columnApi.getAllGridColumns !== 'function') {
			return;
		}

		const orderedColumns: Column[] = columnApi.getAllGridColumns() ?? [];
		const orderedFields: string[] = [];

		for (const gridColumn of orderedColumns) {
			if (!gridColumn) {
				continue;
			}
			const colDef = typeof gridColumn.getColDef === 'function' ? gridColumn.getColDef() : null;
			const field = colDef?.field;
			const fallback = typeof gridColumn.getColId === 'function' ? gridColumn.getColId() : null;
			const value = field ?? fallback;
			if (!value || value === '#' || value === 'status' || value === ROW_ID_FIELD) {
				continue;
			}
			if (!orderedFields.includes(value)) {
				orderedFields.push(value);
			}
		}

		if (orderedFields.length === 0) {
			return;
		}

		this.columnOrderChangeCallback(orderedFields);
	}

	private findRowNodeByBlockIndex(blockIndex: number): IRowNode<RowData> | null {
		if (!this.gridApi) return null;

		let match: IRowNode<RowData> | null = null;
		this.gridApi.forEachNode(node => {
			if (match) return;
			const data = node.data as RowData | undefined;
			if (!data) return;
			const raw = data[ROW_ID_FIELD];
			const parsed = raw !== undefined ? parseInt(String(raw), 10) : NaN;
			if (!Number.isNaN(parsed) && parsed === blockIndex) {
				match = node as IRowNode<RowData>;
			}
		});

		return match;
	}

	/**
	 * 开始编辑当前聚焦的单元格
	 */
	startEditingFocusedCell(): void {
		if (!this.gridApi) return;

		const focusedCell = this.gridApi.getFocusedCell();
		if (!focusedCell) return;

		this.gridApi.startEditingCell({
			rowIndex: focusedCell.rowIndex,
			colKey: focusedCell.column.getColId()
		});
	}

	/**
	 * 获取当前聚焦的单元格信息
	 */
	getFocusedCell(): { rowIndex: number; field: string } | null {
		if (!this.gridApi) return null;

		const focusedCell = this.gridApi.getFocusedCell();
		if (!focusedCell) return null;

		// 获取块索引
		const rowNode = this.gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
		const data = rowNode?.data as RowData | undefined;
		if (!data) return null;

		const raw = data[ROW_ID_FIELD];
		const blockIndex = raw !== undefined ? parseInt(String(raw), 10) : NaN;
		if (Number.isNaN(blockIndex)) return null;

		return {
			rowIndex: blockIndex,
			field: focusedCell.column.getColId()
		};
	}

	private applyQuickFilterText(): void {
		if (!this.gridApi) {
			return;
		}
		const api = this.gridApi as GridApi;
		const anyApi = api as GridApi & {
			setQuickFilter?: (value: string) => void;
			setQuickFilterColumns?: (columns: string[]) => void;
			getColumns?: () => Column[] | null;
			setGridOption?: (key: string, value: unknown) => void;
			onFilterChanged?: () => void;
		};

		if (typeof anyApi.setQuickFilterColumns === 'function' && typeof anyApi.getColumns === 'function') {
			const columns = anyApi.getColumns() ?? [];
			const filterable: string[] = [];
			for (const column of columns) {
				if (!column) {
					continue;
				}
				const colId = typeof column.getColId === 'function'
					? column.getColId()
					: typeof (column as any).getId === 'function'
						? (column as any).getId()
						: null;
				if (!colId) {
					continue;
				}
				if (colId === '#' || colId === ROW_ID_FIELD || colId === 'status') {
					continue;
				}
				if (typeof column.isVisible === 'function' && !column.isVisible()) {
					continue;
				}
				filterable.push(colId);
			}
			anyApi.setQuickFilterColumns(filterable);
		}

		if (typeof anyApi.setQuickFilter === 'function') {
			anyApi.setQuickFilter(this.quickFilterText);
		} else if (typeof anyApi.setGridOption === 'function') {
			anyApi.setGridOption('quickFilterText', this.quickFilterText);
			if (typeof anyApi.onFilterChanged === 'function') {
				anyApi.onFilterChanged();
			}
		}
	}

	/**
	 * 监听 Enter 键在最后一行按下的事件
	 */
	onEnterAtLastRow(callback: (field: string) => void): void {
		this.enterAtLastRowCallback = callback;
	}

}
