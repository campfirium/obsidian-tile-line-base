/**
 * GridAdapter - 表格适配器接口
 *
 * 定义统一的表格操作接口，与具体的表格库实现解耦。
 * 这样我们可以在未来轻松替换表格库（AG Grid → TanStack Table → 其他）
 * 而不需要修改业务逻辑代码。
 */

/**
 * 列定义
 */
export interface ColumnDef {
	field: string;       // 字段名（列ID）
	headerName: string;  // 表头显示名称
	editable: boolean;   // 是否可编辑
}

/**
 * 行数据
 * 使用动态键值对，字段名作为键
 */
export interface RowData {
	[key: string]: string;
}

/**
 * 单元格编辑事件
 */
export interface CellEditEvent {
	rowIndex: number;   // 行索引
	field: string;      // 字段名
	newValue: string;   // 新值
	oldValue: string;   // 旧值
}

/**
 * 表头编辑事件
 */
export interface HeaderEditEvent {
	field: string;      // 原字段名
	newName: string;    // 新表头名称
}

/**
 * GridAdapter 接口
 *
 * 所有表格适配器必须实现此接口
 */
export interface GridAdapter {
	/**
	 * 挂载表格到指定容器
	 * @param container - 容器 DOM 元素
	 * @param columns - 列定义数组
	 * @param rows - 行数据数组
	 */
	mount(
		container: HTMLElement,
		columns: ColumnDef[],
		rows: RowData[]
	): void;

	/**
	 * 更新表格数据
	 * @param rows - 新的行数据数组
	 */
	updateData(rows: RowData[]): void;

	/**
	 * 监听单元格编辑事件
	 * @param callback - 编辑事件回调函数
	 */
	onCellEdit(callback: (event: CellEditEvent) => void): void;

	/**
	 * 监听表头编辑事件
	 * @param callback - 表头编辑事件回调函数
	 */
	onHeaderEdit(callback: (event: HeaderEditEvent) => void): void;

	/**
	 * 销毁表格实例，释放资源
	 */
	destroy(): void;

	/**
	 * 获取当前选中的行索引
	 * @returns 选中行的索引数组，无选中时返回空数组
	 */
	getSelectedRows(): number[];

	/**
	 * 注册添加行操作的回调
	 * @param callback 添加行时的回调函数
	 */
	onAddRow(callback: () => void): void;

	/**
	 * 注册删除行操作的回调
	 * @param callback 删除行时的回调函数，参数为行索引
	 */
	onDeleteRow(callback: (rowIndex: number) => void): void;
}
