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
	ModuleRegistry,
	AllCommunityModule,
	IRowNode,
	GetContextMenuItemsParams,
	MenuItemDef
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
import { setIcon } from 'obsidian';

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

	// 🔑 用于在 pop-out 窗口中捕获启动编辑的按键
	private lastKeyPressedForEdit: string | null = null;

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
		// 转换列定义为 AG Grid 格式
		const colDefs: ColDef[] = columns.map(col => {
			// 序号列特殊处理
			if (col.field === '#') {
				return {
					field: col.field,
					headerName: col.headerName,
					editable: false,
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
					width: 60,  // 固定宽度
					resizable: false,
					sortable: true,
					filter: true,
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
				filter: true, // 启用筛选
				resizable: true, // 可调整列宽
				wrapText: true, // 文本自动换行
				autoHeight: true, // 行高自动适应内容
			};

			// 合并用户配置（width, flex 等）
			const mergedColDef = { ...baseColDef, ...(col as any) };

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

		// 获取容器所在的 document 和 body（支持 pop-out 窗口）
		const ownerDoc = container.ownerDocument;
		const popupParent = ownerDoc.body;

		// 🔍 调试：检查 AG Grid 初始化环境
		console.log('=== AG Grid 初始化 ===');
		console.log('container:', container);
		console.log('container.ownerDocument:', ownerDoc);
		console.log('ownerDoc === document:', ownerDoc === document);
		console.log('popupParent:', popupParent);
		console.log('=======================');

		// 创建 AG Grid 配置
		const gridOptions: GridOptions = {
			columnDefs: colDefs,
			rowData: rows,

			// 提供稳定的行 ID（用于增量更新和状态管理）
			getRowId: (params) => {
				return String(params.data[ROW_ID_FIELD]);
			},

			// 传递上下文（包含回调函数）
			context: context || {},

			// 设置弹出元素的父容器（支持 pop-out 窗口）
			popupParent: popupParent,

			// 编辑配置（使用单元格编辑模式而非整行编辑）
			singleClickEdit: false, // 禁用单击编辑，双击或按键可以进入编辑
			stopEditingWhenCellsLoseFocus: true, // 失焦时停止编辑

			// Enter 键导航配置（Excel 风格）
			enterNavigatesVertically: true, // Enter 键垂直导航
			enterNavigatesVerticallyAfterEdit: true, // 编辑后 Enter 垂直导航

			// 行选择配置（支持多行选择，Shift+点击范围选择，Ctrl+点击多选）
			rowSelection: 'multiple',

			// 事件监听
			onCellEditingStopped: (event: CellEditingStoppedEvent) => {
				this.handleCellEdit(event);
			},

			// 默认列配置
			defaultColDef: {
				editable: true,
				sortable: true,
				filter: true,
				resizable: true,
				cellEditor: createTextCellEditor(), // 🔑 使用工厂函数创建编辑器，支持 pop-out 窗口
				cellEditorParams: (params: any) => {
					// 🔑 传递我们手动捕获的按键（用于 pop-out 窗口）
					const capturedKey = this.lastKeyPressedForEdit;
					// 清除状态，避免影响下次编辑
					this.lastKeyPressedForEdit = null;

					return {
						...params,
						// 如果 AG Grid 没有传递 eventKey（pop-out 窗口的情况），使用我们捕获的按键
						manualEventKey: capturedKey
					};
				},
				suppressKeyboardEvent: (params: any) => {
					const keyEvent = params.event as KeyboardEvent;

					// 🔑 捕获可打印字符，用于 pop-out 窗口的首字符修复
					// 在 pop-out 窗口中，AG Grid 不会传递 eventKey，所以我们手动捕获
					if (!params.editing && keyEvent.type === 'keydown') {
						// 判断是否为可打印字符（单个字符，非修饰键）
						const isPrintableChar = keyEvent.key.length === 1 &&
							!keyEvent.ctrlKey && !keyEvent.altKey && !keyEvent.metaKey;

						if (isPrintableChar) {
							// 存储这个按键，稍后在编辑器初始化时使用
							this.lastKeyPressedForEdit = keyEvent.key;
							console.log('[AgGridAdapter] 捕获启动编辑的按键:', keyEvent.key);
						}
					}

					if (keyEvent.key !== 'Enter') {
						return false;
					}

					const api = params.api;
					const rowIndex = params.node.rowIndex;
					const totalRows = api.getDisplayedRowCount();
					const colId = params.column.getColId();
					const isLastRow = rowIndex === totalRows - 1;

					// 未进入编辑时，Enter 只导航行
					if (!params.editing) {
						if (isLastRow) {
							// 最后一行：触发新增行逻辑（交由上层处理）
							if (this.enterAtLastRowCallback) {
								keyEvent.preventDefault();
								setTimeout(() => {
									this.enterAtLastRowCallback?.(colId);
								}, 0);
								return true;
							}

							return false;
						}

						// 普通行：移动到下一行同一列
						keyEvent.preventDefault();
						setTimeout(() => {
							const nextIndex = Math.min(rowIndex + 1, totalRows - 1);
							if (nextIndex !== rowIndex) {
								api.ensureIndexVisible(nextIndex);
							}
							api.setFocusedCell(nextIndex, colId);
							const nextNode = api.getDisplayedRowAtIndex(nextIndex);
							nextNode?.setSelected(true, true);
						}, 0);

						return true;
					}

					// 编辑状态下的最后一行：提交并新增行
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

					// 交由 AG Grid 默认处理（例如继续向下导航）
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

			// 右键菜单配置
			getContextMenuItems: (params: GetContextMenuItemsParams) => {
				const field = params.column?.getColId();

				// 如果是 status 列，显示状态菜单
				if (field === 'status') {
					const rowId = params.node?.id;
					if (!rowId) return ['copy', 'export'];

					const currentStatus = normalizeStatus(params.node?.data?.status);

					// 返回 5 种状态的菜单项
					return [
						{
							name: '待办 ☐',
							disabled: currentStatus === 'todo',
							action: () => {
								context?.onStatusChange?.(rowId, 'todo');
							}
						},
						{
							name: '已完成 ☑',
							disabled: currentStatus === 'done',
							action: () => {
								context?.onStatusChange?.(rowId, 'done');
							}
						},
						{
							name: '进行中 ⊟',
							disabled: currentStatus === 'inprogress',
							action: () => {
								context?.onStatusChange?.(rowId, 'inprogress');
							}
						},
						{
							name: '已搁置 ⏸',
							disabled: currentStatus === 'onhold',
							action: () => {
								context?.onStatusChange?.(rowId, 'onhold');
							}
						},
						{
							name: '已放弃 ☒',
							disabled: currentStatus === 'canceled',
							action: () => {
								context?.onStatusChange?.(rowId, 'canceled');
							}
						},
						'separator',
						'copy',
						'export'
					];
				}

				// 其他列使用默认菜单
				return ['copy', 'export'];
			}
		};

		// 创建并挂载 AG Grid
		this.gridApi = createGrid(container, gridOptions);
		this.lastAutoSizeTimestamp = 0;
		this.shouldAutoSizeOnNextResize = false;
		this.clearRowHeightResetHandle();

		// 对短文本列执行一次性 autoSize（不会随窗口变化重复执行）
		setTimeout(() => {
			this.autoSizeShortTextColumns(colDefs);
			this.shouldAutoSizeOnNextResize = false;
		}, 100);
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
		}
	}

	markLayoutDirty(): void {
		this.shouldAutoSizeOnNextResize = true;
		this.queueRowHeightSync();
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
