# T0008_集成AG_Grid表格组件

**状态：** 进行中
**分支：** feat/T0008-ag-grid-integration
**积木编号：** 积木 8

## 学习目标

- 理解适配器模式（Adapter Pattern）
- 掌握第三方表格库的集成
- 学习接口抽象与解耦设计
- 掌握 AG Grid Community 的基本使用

## 功能描述

将手动实现的表格替换为专业的 AG Grid Community 表格组件，通过 `GridAdapter` 抽象层进行集成，保证未来的可扩展性。

### 核心功能

1. **GridAdapter 接口**
   - 定义统一的表格操作接口
   - 与具体表格库解耦
   - 支持挂载、更新、事件监听、状态管理

2. **AgGridAdapter 实现**
   - 使用 AG Grid Community 实现 GridAdapter 接口
   - 处理单元格编辑事件
   - 支持表头编辑
   - 处理容器尺寸变化

3. **重构 TableView**
   - 用 GridAdapter 替换手动表格渲染
   - 保持现有的 H2 解析和写回逻辑
   - 监听编辑事件触发自动保存

## 完成标准

- [ ] 安装 AG Grid Community 依赖
- [ ] 创建 GridAdapter 接口定义
- [ ] 实现 AgGridAdapter
- [ ] 重构 TableView 使用 GridAdapter
- [ ] 单元格编辑功能正常
- [ ] 表头编辑功能正常
- [ ] 自动保存（500ms 防抖）正常
- [ ] 切换视图后数据持久化正常
- [ ] 表格样式与 Obsidian 主题一致

## 技术要点

### GridAdapter 接口设计

```typescript
export interface ColumnDef {
  field: string;
  headerName: string;
  editable: boolean;
}

export interface RowData {
  [key: string]: string;
}

export interface CellEditEvent {
  rowIndex: number;
  field: string;
  newValue: string;
  oldValue: string;
}

export interface GridAdapter {
  /**
   * 挂载表格到指定容器
   */
  mount(
    container: HTMLElement,
    columns: ColumnDef[],
    rows: RowData[]
  ): void;

  /**
   * 更新表格数据
   */
  updateData(rows: RowData[]): void;

  /**
   * 监听单元格编辑事件
   */
  onCellEdit(callback: (event: CellEditEvent) => void): void;

  /**
   * 监听表头编辑事件
   */
  onHeaderEdit(callback: (field: string, newName: string) => void): void;

  /**
   * 销毁表格实例
   */
  destroy(): void;
}
```

### AgGridAdapter 实现要点

```typescript
import { Grid, GridOptions, ColDef } from 'ag-grid-community';

export class AgGridAdapter implements GridAdapter {
  private gridApi: any;
  private gridOptions: GridOptions;
  private cellEditCallback?: (event: CellEditEvent) => void;

  mount(container: HTMLElement, columns: ColumnDef[], rows: RowData[]): void {
    // 转换列定义
    const colDefs: ColDef[] = columns.map(col => ({
      field: col.field,
      headerName: col.headerName,
      editable: col.editable,
      // 单元格失焦时触发保存（兼容输入法）
      onCellValueChanged: (params) => {
        if (this.cellEditCallback) {
          this.cellEditCallback({
            rowIndex: params.node.rowIndex,
            field: params.colDef.field,
            newValue: params.newValue,
            oldValue: params.oldValue
          });
        }
      }
    }));

    // 创建表格配置
    this.gridOptions = {
      columnDefs: colDefs,
      rowData: rows,
      // 其他配置...
    };

    // 挂载表格
    this.gridApi = new Grid(container, this.gridOptions);
  }

  onCellEdit(callback: (event: CellEditEvent) => void): void {
    this.cellEditCallback = callback;
  }

  destroy(): void {
    if (this.gridApi) {
      this.gridApi.destroy();
    }
  }
}
```

### TableView 重构

```typescript
import { GridAdapter } from './grid/GridAdapter';
import { AgGridAdapter } from './grid/AgGridAdapter';

export class TableView extends ItemView {
  private gridAdapter: GridAdapter | null = null;

  async render(): Promise<void> {
    // ... 解析 H2 块 ...

    // 准备列定义
    const columns = this.schema.columnNames.map(name => ({
      field: name,
      headerName: name,
      editable: true
    }));

    // 准备行数据
    const rows = this.extractTableData(this.blocks, this.schema);

    // 创建并挂载表格
    this.gridAdapter = new AgGridAdapter();
    this.gridAdapter.mount(tableContainer, columns, rows);

    // 监听编辑事件
    this.gridAdapter.onCellEdit((event) => {
      this.onCellEdit(event.rowIndex, event.field, event.newValue);
    });
  }

  async onClose(): Promise<void> {
    if (this.gridAdapter) {
      this.gridAdapter.destroy();
      this.gridAdapter = null;
    }
  }
}
```

## 边界情况

1. **输入法兼容性**
   - 使用 `onCellValueChanged` 而非 `onCellEditingStarted`
   - 在编辑结束/失焦时才触发保存
   - 确保中文输入完整性

2. **容器尺寸变化**
   - Obsidian 面板切换时表格可能变形
   - 需要监听容器变化，调用 `api.sizeColumnsToFit()`

3. **表头编辑**
   - AG Grid 默认不支持表头编辑
   - 方案 1：使用自定义 Header Component
   - 方案 2：在表头上方添加独立的编辑层

4. **数据同步**
   - 确保 AG Grid 的数据变化同步到 blocks 数组
   - 编辑后触发 scheduleSave()

## 测试步骤

1. 打开包含 H2 块的测试文件
2. 切换到表格视图
3. 验证表格正确渲染（使用 AG Grid）
4. 编辑单元格，按 Enter 或失焦
5. 查看控制台 "✅ 文件已保存" 日志
6. 切换回 Markdown 视图，验证内容已更新
7. 测试表头编辑功能
8. 测试排序功能（AG Grid 内置）
9. 测试筛选功能（AG Grid 内置）
10. 验证主题样式与 Obsidian 一致

## AG Grid 样式定制

```css
/* AG Grid 主题适配 Obsidian */
.ag-theme-obsidian {
  --ag-background-color: var(--background-primary);
  --ag-foreground-color: var(--text-normal);
  --ag-header-background-color: var(--background-modifier-border);
  --ag-odd-row-background-color: var(--background-secondary-alt);
  --ag-border-color: var(--background-modifier-border);
}

.ag-theme-obsidian .ag-header-cell {
  font-weight: 600;
}

.ag-theme-obsidian .ag-cell {
  border-right: 1px solid var(--background-modifier-border);
}
```

## 下一步

完成后可以继续：
- 积木 9：利用 AG Grid 的内置排序功能
- 积木 10：利用 AG Grid 的内置筛选功能
- 积木 11：添加/删除行功能
- 积木 12：表格状态持久化（列宽、排序、筛选状态）

## 参考资源

- AG Grid 官方文档：https://www.ag-grid.com/javascript-data-grid/
- AG Grid Community 版本功能：https://www.ag-grid.com/javascript-data-grid/licensing/
- Obsidian 插件开发文档：https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
