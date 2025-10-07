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
					cellStyle: { textAlign: 'center' }  // 居中显示
				};
			}

			// 保留从 ColumnDef 传入的所有配置（包括 width、flex）
			return {
				field: col.field,
				headerName: col.headerName,
				editable: col.editable,
				sortable: true, // 启用排序
				filter: true, // 启用筛选
				resizable: true, // 可调整列宽
				wrapText: true, // 文本自动换行
				autoHeight: true, // 行高自动适应内容
				...(col as any), // 保留所有额外属性（width, flex 等）
			};
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
		};

		// 创建并挂载 AG Grid
		this.gridApi = createGrid(container, gridOptions);

		// 自动调整没有指定宽度的列（根据内容）
		setTimeout(() => {
			this.autoSizeColumns(colDefs);
		}, 100);
	}

	/**
	 * 自动调整没有 width/flex 的列宽度
	 */
	private autoSizeColumns(colDefs: ColDef[]): void {
		if (!this.gridApi) return;

		// 找出所有没有指定 width 或 flex 的列
		const autoSizeColumnIds: string[] = [];
		for (const colDef of colDefs) {
			// 跳过序号列
			if (colDef.field === '#') continue;

			const hasWidth = (colDef as any).width !== undefined;
			const hasFlex = (colDef as any).flex !== undefined;

			if (!hasWidth && !hasFlex && colDef.field) {
				autoSizeColumnIds.push(colDef.field);
			}
		}

		if (autoSizeColumnIds.length > 0) {
			console.log('🔧 Auto-sizing columns:', autoSizeColumnIds);
			this.gridApi.autoSizeColumns(autoSizeColumnIds);
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
}
