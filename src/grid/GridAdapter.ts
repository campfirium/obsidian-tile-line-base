/**
 * GridAdapter - 表格适配器接口
 *
 * 定义统一的表格操作接口，与具体的表格库实现解耦。
 * 这样我们可以在未来轻松替换表格库（AG Grid → TanStack Table → 其他）
 * 而不需要修改业务逻辑代码。
 */

export const ROW_ID_FIELD = '__tlb_row_id';

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
	rowData: RowData;   // 当前行数据
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
	 * @returns 选中行对应的块索引数组，无选中时返回空数组
	 */
	getSelectedRows(): number[];

	/**
	 * 根据鼠标事件获取块索引
	 * @param event 鼠标事件
	 * @returns 块索引，如果未找到则返回 null
	 */
	getRowIndexFromEvent(event: MouseEvent): number | null;

	/**
	 * 手动触发列宽调整
	 * 用于处理容器尺寸变化或新窗口初始化的情况
	 */
	resizeColumns?(): void;

	/**
	 * 通知适配器网格布局即将发生变化，做预处理
	 */
	markLayoutDirty?(): void;

	/**
	 * 选中指定块索引对应的行
	 */
	selectRow?(blockIndex: number, options?: { ensureVisible?: boolean }): void;

	/**
	 * 清空当前选中状态
	 */
	clearSelection?(): void;

	/**
	 * 聚焦并启动指定行列的编辑模式
	 */
	startEditingCell?(blockIndex: number, field: string): void;
}
