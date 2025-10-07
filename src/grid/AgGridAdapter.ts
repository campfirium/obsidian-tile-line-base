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
	private addRowCallback?: () => void;
	private deleteRowCallback?: (rowIndex: number) => void;

	/**
	 * 挂载表格到指定容器
	 */
	mount(
		container: HTMLElement,
		columns: ColumnDef[],
		rows: RowData[]
	): void {
		// 转换列定义为 AG Grid 格式
		const colDefs: ColDef[] = columns.map(col => ({
			field: col.field,
			headerName: col.headerName,
			editable: col.editable,
			flex: 1, // 自动调整列宽
			sortable: true, // 启用排序
			filter: true, // 启用筛选
			resizable: true, // 可调整列宽
		}));

		// 创建 AG Grid 配置
		const gridOptions: GridOptions = {
			columnDefs: colDefs,
			rowData: rows,

			// 编辑配置
			editType: 'fullRow', // 整行编辑模式
			singleClickEdit: true, // 单击即可编辑
			stopEditingWhenCellsLoseFocus: true, // 失焦时停止编辑

			// 行选择配置
			rowSelection: 'single', // 单行选择

			// 事件监听
			onCellEditingStopped: (event: CellEditingStoppedEvent) => {
				this.handleCellEdit(event);
			},

			// 自定义右键菜单
			getContextMenuItems: (params) => {
				const menuItems: any[] = [];

				if (params.node) {
					// 右键点击行
					const rowIndex = params.node.rowIndex;

					menuItems.push({
						name: '在上方插入行',
						action: () => {
							if (this.addRowCallback && rowIndex !== null && rowIndex !== undefined) {
								// 暂时在末尾添加，后续支持 afterIndex
								this.addRowCallback();
							}
						},
						icon: '<span class="ag-icon ag-icon-plus" unselectable="on" role="presentation"></span>'
					});

					menuItems.push({
						name: '在下方插入行',
						action: () => {
							if (this.addRowCallback) {
								this.addRowCallback();
							}
						},
						icon: '<span class="ag-icon ag-icon-plus" unselectable="on" role="presentation"></span>'
					});

					menuItems.push('separator');

					menuItems.push({
						name: '删除此行',
						action: () => {
							if (this.deleteRowCallback && rowIndex !== null && rowIndex !== undefined) {
								this.deleteRowCallback(rowIndex);
							}
						},
						icon: '<span class="ag-icon ag-icon-cancel" unselectable="on" role="presentation"></span>',
						cssClasses: ['ag-menu-option-danger']
					});
				}

				return menuItems;
			},

			// 默认列配置
			defaultColDef: {
				editable: true,
				sortable: true,
				filter: true,
				resizable: true,
			},

			// 启用范围选择（支持复制粘贴）
			enableRangeSelection: true,

			// 启用单元格复制粘贴
			enableCellTextSelection: true,
		};

		// 创建并挂载 AG Grid
		this.gridApi = createGrid(container, gridOptions);
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

		// 只有当值真正改变时才触发回调
		if (newValue !== oldValue && field && rowIndex !== null && rowIndex !== undefined) {
			this.cellEditCallback({
				rowIndex: rowIndex,
				field: field,
				newValue: String(newValue || ''),
				oldValue: String(oldValue || '')
			});
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
	 * 注册添加行操作的回调
	 */
	onAddRow(callback: () => void): void {
		this.addRowCallback = callback;
	}

	/**
	 * 注册删除行操作的回调
	 */
	onDeleteRow(callback: (rowIndex: number) => void): void {
		this.deleteRowCallback = callback;
	}
}
