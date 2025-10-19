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
	ModuleRegistry,
	AllCommunityModule,
	IRowNode
} from 'ag-grid-community';
import {
	GridAdapter,
	ColumnDef,
	RowData,
	CellEditEvent,
	HeaderEditEvent,
	ROW_ID_FIELD
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
import { setIcon } from 'obsidian';

const DEFAULT_TEXT_MIN_WIDTH = 160;
const DEFAULT_TEXT_MAX_WIDTH = 360;

// 注册 AG Grid Community 模块
ModuleRegistry.registerModules([AllCommunityModule]);

export class AgGridAdapter implements GridAdapter {
	private gridApi: GridApi | null = null;
	private cellEditCallback?: (event: CellEditEvent) => void;
	private headerEditCallback?: (event: HeaderEditEvent) => void;
	private enterAtLastRowCallback?: (field: string) => void;
	private lastAutoSizeTimestamp = 0;
	private shouldAutoSizeOnNextResize = false;
	private rowHeightResetHandle: number | null = null;
	private static readonly AUTO_SIZE_COOLDOWN_MS = 800;

	// Composition Proxy：每个 Document 一个代理层
	private proxyByDoc = new WeakMap<Document, CompositionProxy>();
	private containerEl: HTMLElement | null = null;
	private focusedDoc: Document | null = null;
	private focusedRowIndex: number | null = null;
	private focusedColId: string | null = null;
	private pendingCaptureCancel?: (reason?: string) => void;
	private editing = false;
	private headerIconCleanup: (() => void) | null = null;

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

	private getCellElementFor(rowIndex: number, colKey: string, doc: Document): HTMLElement | null {
		const root = (this.containerEl ?? doc) as Document | Element;
		const selector = `.ag-center-cols-container [row-index="${rowIndex}"] [col-id="${colKey}"]`;
		return root.querySelector(selector) as HTMLElement | null;
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
			default:
				break;
		}
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
		}
	): void {
		this.containerEl = container;
		this.focusedDoc = container.ownerDocument || document;

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
					width: 60,  // 固定宽度
					maxWidth: 80,
					sortable: true,
					filter: false,
					resizable: false,
					suppressSizeToFit: true,  // 不参与自动调整
					cellStyle: { textAlign: 'center' }  // 居中显示
				};
			}

			// status 列特殊处理
			if (col.field === 'status') {
				return {
					field: col.field,
					headerName: col.headerName || 'Status',
					editable: false,  // 禁用编辑模式
				pinned: 'left',
				lockPinned: true,
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
				wrapText: true, // 文本自动换行
				autoHeight: true, // 行高自动适应内容
			};

			// 合并用户配置（width, flex 等）
			const mergedColDef = { ...baseColDef, ...(col as any) };
			if (typeof col.field === 'string' && col.field !== '#' && col.field !== 'status') {
				if (typeof mergedColDef.minWidth !== 'number') {
					mergedColDef.minWidth = DEFAULT_TEXT_MIN_WIDTH;
				}
				if (typeof mergedColDef.maxWidth !== 'number') {
					mergedColDef.maxWidth = DEFAULT_TEXT_MAX_WIDTH;
				}
			}
			const pinnedFields = new Set(['任务', '任务名称', '任务名', 'task', 'taskName', 'title', '标题']);
			if (typeof col.field === 'string' && pinnedFields.has(col.field)) {
				mergedColDef.pinned = 'left';
				mergedColDef.lockPinned = true;
			}

			// 检查用户是否配置了宽度
			const hasWidth = (col as any).width !== undefined;
			const hasFlex = (col as any).flex !== undefined;
			const hasExplicitWidth = hasWidth && !hasFlex;

			// 保留显式宽度配置（像素值）
			if (hasExplicitWidth) {
				mergedColDef.suppressSizeToFit = true;
			}

			if (!hasWidth && !hasFlex) {
				// 没有用户配置，使用智能策略：
				// 根据内容长度判断是短文本列还是长文本列
				const isLongTextColumn = this.isLongTextColumn(col.field!, rows);

				if (isLongTextColumn) {
					// 长文本列：使用 flex 分配剩余空间
					mergedColDef.flex = 1;
					mergedColDef.minWidth = 200;
				} else {
					// 短文本列：不设置 width/flex，后续通过 autoSize 一次性计算
					// 设置最大宽度避免过宽
					mergedColDef.maxWidth = 300;
					mergedColDef.suppressSizeToFit = true; // 避免 sizeColumnsToFit 拉伸短文本列
				}
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
			columnDefs: colDefs,
			rowData: rows,

			// 提供稳定的行 ID（用于增量更新和状态管理）
			enableBrowserTooltips: true,
			tooltipShowDelay: 0,
			tooltipHideDelay: 200,
			getRowId: (params) => {
				return String(params.data[ROW_ID_FIELD]);
			},

			// 传递上下文（包含回调函数）
			context: context || {},

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
				enableSelectionWithoutKeys: true,
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

					if (!params.editing) {
						return false;
					}

					if (keyEvent.key !== 'Enter') {
						return false;
					}

					const api = params.api;
					const rowIndex = params.node.rowIndex;
					const totalRows = api.getDisplayedRowCount();
					const colId = params.column.getColId();
					const isLastRow = rowIndex === totalRows - 1;

					if (isLastRow && this.enterAtLastRowCallback) {
						keyEvent.preventDefault();
						setTimeout(() => {
							api.stopEditing();
							setTimeout(() => {
								this.enterAtLastRowCallback?.(colId);
							}, 10);
						}, 0);

						return true;
					}

					return false;
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
		this.lastAutoSizeTimestamp = 0;
		this.shouldAutoSizeOnNextResize = false;
		this.clearRowHeightResetHandle();
		this.setupHeaderIcons(ownerDoc ?? document);

		['ag-Grid-SelectionColumn', 'ag-Grid-AutoColumn'].forEach((colId) => {
			if (this.gridApi?.getColumn(colId)) {
				this.gridApi.setColumnsVisible([colId], false);
			}
		});

		// 对短文本列执行一次性 autoSize（不会随窗口变化重复执行）
		setTimeout(() => {
			this.autoSizeShortTextColumns(colDefs);
			this.shouldAutoSizeOnNextResize = false;
		}, 100);
	}

	private setupHeaderIcons(doc: Document): void {
		this.cleanupHeaderIcons();
		const api = this.gridApi;
		if (!api) {
			return;
		}

		const update = () => {
			this.updateHeaderIcons(doc);
		};

		const events = [
			'firstDataRendered',
			'columnEverythingChanged',
			'displayedColumnsChanged',
			'sortChanged',
			'columnResized'
		] as const;

		events.forEach((eventName) => {
			api.addEventListener(eventName, update);
		});

		const win = doc.defaultView ?? window;
		win.setTimeout(() => update(), 0);

		this.headerIconCleanup = () => {
			events.forEach((eventName) => {
				api.removeEventListener(eventName, update);
			});
		};
	}

	private updateHeaderIcons(doc: Document): void {
		if (!this.gridApi) {
			return;
		}

		type HeaderIconConfig = {
			field: string;
			cellClass: string;
			labelClass: string;
			iconClass: string;
			icon: string;
			fallbacks?: string[];
			hideLabel?: boolean;
			tooltip?: string;
		};

		const configs: HeaderIconConfig[] = [
			{
				field: '#',
				cellClass: 'tlb-index-header-cell',
				labelClass: 'tlb-index-header-label',
				iconClass: 'tlb-index-header-icon',
				icon: 'hashtag',
				fallbacks: ['hash'],
				hideLabel: true,
				tooltip:
					this.gridApi.getColumn('#')?.getColDef().headerTooltip ||
					this.gridApi.getColumn('#')?.getColDef().headerName ||
					'Index'
			},
			{
				field: 'status',
				cellClass: 'tlb-status-header-cell',
				labelClass: 'tlb-status-header-label',
				iconClass: 'tlb-status-header-icon',
				icon: 'list-checks',
				fallbacks: ['checklist', 'check-square'],
				hideLabel: true,
				tooltip:
					this.gridApi.getColumn('status')?.getColDef().headerTooltip ||
					this.gridApi.getColumn('status')?.getColDef().headerName ||
					'Status'
			}
		];

		for (const config of configs) {
			const headerCell = doc.querySelector<HTMLElement>(`.ag-header-cell[col-id="${config.field}"]`);
			if (!headerCell) {
				continue;
			}

			headerCell.classList.add(config.cellClass);

			const label = headerCell.querySelector<HTMLElement>('.ag-header-cell-label');
			if (!label) {
				continue;
			}

			label.classList.add(config.labelClass);

			let iconEl = headerCell.querySelector<HTMLElement>(`.${config.iconClass}`);
			if (!iconEl) {
				iconEl = doc.createElement('div');
				iconEl.className = config.iconClass;
				label.insertBefore(iconEl, label.firstChild ?? null);
			}

			setIcon(iconEl, config.icon);
			if (!iconEl.querySelector('svg') && config.fallbacks) {
				for (const fallback of config.fallbacks) {
					setIcon(iconEl, fallback);
					if (iconEl.querySelector('svg')) {
						break;
					}
				}
			}
			iconEl.setAttribute('aria-hidden', 'true');
			iconEl.setAttribute('role', 'presentation');

			const textEl = label.querySelector<HTMLElement>('.ag-header-cell-text');
			if (textEl && config.hideLabel) {
				textEl.textContent = '';
			}

			if (config.tooltip) {
				headerCell.setAttribute('title', config.tooltip);
				iconEl.setAttribute('aria-label', config.tooltip);
			}
		}
	}

	private cleanupHeaderIcons(): void {
		if (this.headerIconCleanup) {
			this.headerIconCleanup();
			this.headerIconCleanup = null;
		}
	}

	/**
	 * 判断是否为长文本列
	 * 策略：扫描该列所有数据，计算最大内容长度
	 */
	private isLongTextColumn(field: string, rows: RowData[]): boolean {
		const LONG_TEXT_THRESHOLD = 30; // 字符数阈值

		// 计算该列所有行的最大内容长度
		let maxLength = 0;
		for (const row of rows) {
			const value = String(row[field] || '');
			maxLength = Math.max(maxLength, value.length);
		}

		return maxLength > LONG_TEXT_THRESHOLD;
	}

	/**
	 * 对短文本列执行一次性 autoSize
	 */
	private autoSizeShortTextColumns(colDefs: ColDef[]): void {
		if (!this.gridApi) return;

		// 找出所有短文本列（没有 width/flex 的列）
		const shortTextColumnIds: string[] = [];
		for (const colDef of colDefs) {
			// 跳过序号列
			if (colDef.field === '#') continue;

			const hasWidth = (colDef as any).width !== undefined;
			const hasFlex = (colDef as any).flex !== undefined;

			if (!hasWidth && !hasFlex && colDef.field) {
				shortTextColumnIds.push(colDef.field);
			}
		}

		if (shortTextColumnIds.length > 0) {
			this.gridApi.autoSizeColumns(shortTextColumnIds, false); // false = 不跳过 header
		}
	}

	/**
	 * 处理单元格编辑事件
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
			// 允许下一次 resizeColumns 重启 autoSize，确保新数据也能触发宽度调整
			this.lastAutoSizeTimestamp = 0;
			this.shouldAutoSizeOnNextResize = true;
			this.queueRowHeightSync();
			this.armProxyForCurrentCell();
		}
	}

	markLayoutDirty(): void {
		this.shouldAutoSizeOnNextResize = true;
		this.queueRowHeightSync();
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

	/**
	 * 销毁表格实例
	 */
	destroy(): void {
		this.clearRowHeightResetHandle();
		this.cleanupHeaderIcons();
		if (this.gridApi) {
			this.gridApi.destroy();
			this.gridApi = null;
		}
	}

	/**
	 * 获取当前选中的块索引
	 */
	getSelectedRows(): number[] {
		if (!this.gridApi) return [];

		const selectedNodes = this.gridApi.getSelectedNodes();
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

		// 先触发一次布局刷新，确保网格识别最新容器尺寸（不同版本API兼容）
		const containerWidth = this.containerEl?.clientWidth ?? 0;
		const containerHeight = this.containerEl?.clientHeight ?? 0;
		if (containerWidth <= 0 || containerHeight <= 0) {
			// 网格尚未可见，延迟到下一次尺寸变化再调整
			this.shouldAutoSizeOnNextResize = true;
			return;
		}

		const gridApiAny = this.gridApi as any;
		gridApiAny?.doLayout?.();
		gridApiAny?.checkGridSize?.();

		// 获取当前容器信息
		const allColumns = this.gridApi.getAllDisplayedColumns() || [];

		// 分类列：flex 列、固定宽度列、短文本列
		const flexColumnIds: string[] = [];
		const fixedWidthColumnIds: string[] = [];
		const shortTextColumnIds: string[] = [];

		for (const col of allColumns) {
			const colDef = col.getColDef();
			const field = colDef.field;

			// 跳过序号列
			if (field === '#') continue;

			const hasWidth = (colDef as any).width !== undefined;
			const hasFlex = (colDef as any).flex !== undefined;

			if (hasFlex) {
				flexColumnIds.push(field!);
			} else if (hasWidth) {
				fixedWidthColumnIds.push(field!);
			} else {
				shortTextColumnIds.push(field!);
			}
		}

		// 1. 先对短文本列执行 autoSize（计算内容宽度）
		const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
		const shouldAutoSize = now - this.lastAutoSizeTimestamp >= AgGridAdapter.AUTO_SIZE_COOLDOWN_MS;

		if (shortTextColumnIds.length > 0 && shouldAutoSize && this.shouldAutoSizeOnNextResize) {
			this.gridApi.autoSizeColumns(shortTextColumnIds, false);
			this.lastAutoSizeTimestamp = now;
			this.shouldAutoSizeOnNextResize = false;
		}

		// 2. 如果存在 flex 列，让它们分配剩余空间
		if (flexColumnIds.length > 0) {
			this.gridApi.sizeColumnsToFit();
		}

		// 3. 在下一帧重算行高，确保 wrapText + autoHeight 及时响应宽度变化
		this.queueRowHeightSync();

		// 额外刷新单元格，帮助立即应用新宽度
		this.gridApi.refreshCells({ force: true });
	}

	private queueRowHeightSync(): void {
		if (!this.gridApi) return;

		this.clearRowHeightResetHandle();

		const api = this.gridApi;

		const resetNodeHeights = () => {
			if (!this.gridApi) return;
			this.gridApi.forEachNode(node => node.setRowHeight(undefined));
		};

		const runReset = () => {
			if (!this.gridApi) return;
			resetNodeHeights();
			api.stopEditing();
			// 注意：autoHeight 模式下不需要调用 resetRowHeights()
			api.onRowHeightChanged();
			api.refreshCells({ force: true });
			api.refreshClientSideRowModel?.('nothing');
			api.redrawRows();
		};

		const first = () => runReset();
		const second = () => runReset();
		const third = () => runReset();
		const fourth = () => runReset();
		const fifth = () => runReset();

		if (typeof requestAnimationFrame === 'function') {
			this.rowHeightResetHandle = requestAnimationFrame(() => {
				this.rowHeightResetHandle = null;
				first();
			});
		} else {
			setTimeout(first, 0);
		}

		setTimeout(second, 120);
		setTimeout(third, 300);
		setTimeout(fourth, 600);
		setTimeout(fifth, 900);
	}

	private clearRowHeightResetHandle(): void {
		if (this.rowHeightResetHandle !== null) {
			if (typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(this.rowHeightResetHandle);
			}
			this.rowHeightResetHandle = null;
		}
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

	/**
	 * 监听 Enter 键在最后一行按下的事件
	 */
	onEnterAtLastRow(callback: (field: string) => void): void {
		this.enterAtLastRowCallback = callback;
	}

}
