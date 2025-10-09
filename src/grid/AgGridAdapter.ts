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
	AllCommunityModule
} from 'ag-grid-community';
import {
	GridAdapter,
	ColumnDef,
	RowData,
	CellEditEvent,
	HeaderEditEvent
} from './GridAdapter';

// 注册 AG Grid Community 模块
ModuleRegistry.registerModules([AllCommunityModule]);

export class AgGridAdapter implements GridAdapter {
	private gridApi: GridApi | null = null;
	private cellEditCallback?: (event: CellEditEvent) => void;
	private headerEditCallback?: (event: HeaderEditEvent) => void;

	/**
	 * 挂载表格到指定容器
	 */
	mount(
		container: HTMLElement,
		columns: ColumnDef[],
		rows: RowData[]
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

		// 创建 AG Grid 配置
		const gridOptions: GridOptions = {
			columnDefs: colDefs,
			rowData: rows,

			// 编辑配置（使用单元格编辑模式而非整行编辑）
			singleClickEdit: true, // 单击即可编辑
			stopEditingWhenCellsLoseFocus: true, // 失焦时停止编辑

			// 行选择配置
			rowSelection: 'single', // 单行选择

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
			},

			// 启用单元格复制粘贴
			enableCellTextSelection: true,

			// 性能优化：减少不必要的重绘
			suppressAnimationFrame: false,  // 保留动画帧以提升流畅度
			suppressColumnVirtualisation: false,  // 保留列虚拟化以提升性能
		};

		// 创建并挂载 AG Grid
		this.gridApi = createGrid(container, gridOptions);

		// 对短文本列执行一次性 autoSize（不会随窗口变化重复执行）
		setTimeout(() => {
			this.autoSizeShortTextColumns(colDefs);
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
			console.log('🔧 Auto-sizing short text columns:', shortTextColumnIds);
			this.gridApi.autoSizeColumns(shortTextColumnIds, false); // false = 不跳过 header

			// 边界检查：如果短文本列总宽度过大，可能需要水平滚动
			// AG Grid 会自动处理，这里只记录日志
			setTimeout(() => {
				const allColumns = this.gridApi?.getAllDisplayedColumns() || [];
				const totalWidth = allColumns.reduce((sum, col) => sum + (col.getActualWidth() || 0), 0);
				console.log(`📊 表格总宽度: ${totalWidth}px`);
			}, 200);
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

		console.log('🔍 AG Grid Cell Edit Event:', {
			field,
			rowIndex,
			oldValue,
			oldValueType: typeof oldValue,
			newValue,
			newValueType: typeof newValue,
			data: event.data
		});

		if (field && rowIndex !== null && rowIndex !== undefined) {
			// 规范化值（undefined、null、空字符串 都转为空字符串）
			const newStr = String(newValue ?? '');
			const oldStr = String(oldValue ?? '');

			console.log('🔍 Normalized values:', {
				oldStr,
				newStr,
				changed: newStr !== oldStr
			});

			// 只有当值真正改变时才触发回调
			if (newStr !== oldStr) {
				console.log('✅ Triggering cell edit callback');
				this.cellEditCallback({
					rowIndex: rowIndex,
					field: field,
					newValue: newStr,
					oldValue: oldStr
				});
			} else {
				console.log('❌ No change detected, skipping callback');
			}
		}
	}

	/**
	 * 更新表格数据
	 */
	updateData(rows: RowData[]): void {
		if (this.gridApi) {
			this.gridApi.setGridOption('rowData', rows);
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
		console.warn('AgGridAdapter: 表头编辑功能暂未实现');
	}

	/**
	 * 销毁表格实例
	 */
	destroy(): void {
		if (this.gridApi) {
			this.gridApi.destroy();
			this.gridApi = null;
		}
	}

	/**
	 * 获取当前选中的行索引
	 */
	getSelectedRows(): number[] {
		if (!this.gridApi) return [];

		const selectedNodes = this.gridApi.getSelectedNodes();
		return selectedNodes
			.map(node => node.rowIndex)
			.filter(idx => idx !== null && idx !== undefined) as number[];
	}

	/**
	 * 根据鼠标事件获取行索引
	 * @param event 鼠标事件
	 * @returns 行索引，如果未找到则返回 null
	 */
	getRowIndexFromEvent(event: MouseEvent): number | null {
		if (!this.gridApi) return null;

		const target = event.target as HTMLElement;
		const rowElement = target.closest('.ag-row');

		if (!rowElement) return null;

		const rowIndex = rowElement.getAttribute('row-index');
		return rowIndex !== null ? parseInt(rowIndex, 10) : null;
	}

	/**
	 * 手动触发列宽调整
	 * 用于处理容器尺寸变化或新窗口初始化的情况
	 */
	resizeColumns(): void {
		if (!this.gridApi) {
			console.warn('⚠️ gridApi 不存在，跳过列宽调整');
			return;
		}

		console.log('🔄 开始列宽调整...');

		// 获取当前容器信息
		const allColumns = this.gridApi.getAllDisplayedColumns() || [];
		console.log(`📊 当前列数: ${allColumns.length}`);

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

		console.log(`📊 列分类: flex列=${flexColumnIds.length}, 固定宽度列=${fixedWidthColumnIds.length}, 短文本列=${shortTextColumnIds.length}`);

		// 1. 先对短文本列执行 autoSize（计算内容宽度）
		if (shortTextColumnIds.length > 0) {
			console.log('🔧 调整短文本列:', shortTextColumnIds);
			this.gridApi.autoSizeColumns(shortTextColumnIds, false);
		}

		// 2. 如果存在 flex 列，让它们分配剩余空间
		if (flexColumnIds.length > 0) {
			console.log('🔧 执行 sizeColumnsToFit（分配剩余空间给 flex 列）');
			this.gridApi.sizeColumnsToFit();
		} else {
			console.log('ℹ️ 没有 flex 列，跳过 sizeColumnsToFit');
		}

		// 3. 记录最终宽度
		setTimeout(() => {
			const totalWidth = allColumns.reduce((sum, col) => sum + (col.getActualWidth() || 0), 0);
			console.log(`✅ 列宽调整完成，总宽度: ${totalWidth}px`);
		}, 50);
	}
}
