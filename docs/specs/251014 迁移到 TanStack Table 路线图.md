# 迁移到 TanStack Table 路线图

**文档版本：** v1.0
**创建日期：** 2025-10-14
**状态：** 规划中

---

## 一、迁移背景

### 为什么要从 AG Grid 切换到 TanStack Table？

#### 核心问题

1. **AG Grid 对 AI 协作极不友好**
   - 文档混乱：社区版和企业版功能文档混杂，AI 难以区分
   - 更新频繁：API 变化快，AI 训练数据滞后
   - 付费墙：AI 无法访问完整文档
   - API 庞大：配置项过多，AI 容易产生幻觉和错误

2. **已经遇到企业版功能限制**
   - 多次碰到社区版限制，需要妥协或寻找替代方案
   - 试错成本高，开发效率低

3. **TanStack Table 的优势**
   - 文档清晰稳定，单一版本无付费墙
   - API 表面小（Headless 设计），AI 容易理解
   - TypeScript 优先，类型即文档
   - 所有逻辑透明可控，易于调试
   - 社区活跃，示例丰富

#### 时机判断

- ✅ 当前代码量可控（~2500 行）
- ✅ 已有优秀的 GridAdapter 抽象层
- ✅ 项目处于早期，功能还在迭代
- ✅ **越晚切换成本越高**

---

## 二、迁移原则

### 核心原则

1. **渐进式迭代**
   - 每个阶段都保持系统可运行
   - 先实现 MVP，再逐步补齐功能
   - 优先实现核心功能，次要功能可以后续迭代

2. **保持接口稳定**
   - GridAdapter 接口不变
   - TableView 业务逻辑不变
   - 只替换底层实现

3. **AI 协作优先**
   - 代码结构清晰，便于 AI 理解
   - 充分利用 TanStack Table 的简洁性
   - 避免过度设计

---

## 三、迁移路线图

### 阶段 0：准备工作（预计 0.5 天）

**目标：** 研究 TanStack Table，制定技术方案

#### 任务清单

- [x] 研究 TanStack Table v8 核心 API
- [ ] 分析现有 AgGridAdapter 的功能点
- [ ] 设计 TanStackAdapter 接口映射方案
- [ ] 确定技术栈和工具链
  - TanStack Table v8
  - @tanstack/react-virtual（虚拟滚动）
  - CSS Variables（样式系统）

#### 输出

- [ ] 技术方案文档
- [ ] 功能清单对照表

---

### 阶段 1：基础渲染 MVP（预计 1-2 天）

**目标：** 实现最基础的表格渲染和数据展示

#### 功能范围

- ✅ 表格基础渲染（表头 + 数据行）
- ✅ 列定义支持（field, headerName）
- ✅ 数据绑定（updateData）
- ✅ 基础样式（适配 Obsidian 主题）
- ⏭️ 暂不支持：编辑、选择、排序、筛选

#### 实现要点

```typescript
// TanStackAdapter 基础结构
class TanStackAdapter implements GridAdapter {
  private table: Table<RowData> | null = null;
  private containerEl: HTMLElement | null = null;

  mount(container: HTMLElement, columns: ColumnDef[], rows: RowData[]) {
    // 1. 转换列定义
    const tanstackColumns = this.convertColumns(columns);

    // 2. 创建 table 实例
    this.table = createTable({
      data: rows,
      columns: tanstackColumns,
      getCoreRowModel: getCoreRowModel(),
    });

    // 3. 渲染 UI
    this.render(container);
  }

  updateData(rows: RowData[]) {
    // 更新数据并重新渲染
  }

  destroy() {
    // 清理资源
  }
}
```

#### 验收标准

- [ ] 能够显示表格（表头 + 数据）
- [ ] 能够更新数据（updateData 生效）
- [ ] 样式基本适配 Obsidian 主题
- [ ] 序号列正常显示

---

### 阶段 2：单元格编辑（预计 1 天）

**目标：** 实现单元格双击编辑和数据回写

#### 功能范围

- ✅ 双击单元格进入编辑模式
- ✅ 输入框渲染和聚焦
- ✅ Enter/Escape 确认/取消编辑
- ✅ 失焦自动保存
- ✅ 触发 onCellEdit 回调
- ✅ 支持中文输入法（IME）

#### 实现要点

```typescript
// 编辑状态管理
const [editingCell, setEditingCell] = useState<{
  rowIndex: number;
  columnId: string;
} | null>(null);

// 单元格渲染
function Cell({ cell, isEditing }) {
  if (isEditing) {
    return <input
      value={cell.getValue()}
      onChange={(e) => updateCellValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />;
  }
  return <span>{cell.getValue()}</span>;
}
```

#### 验收标准

- [ ] 双击单元格可编辑
- [ ] Enter 保存，Escape 取消
- [ ] 失焦自动保存
- [ ] 中文输入法正常工作
- [ ] 数据正确写回 Markdown

---

### 阶段 3：行选择（预计 0.5 天）

**目标：** 实现单选、多选、范围选择

#### 功能范围

- ✅ 单击选择单行
- ✅ Ctrl/Cmd + 点击多选
- ✅ Shift + 点击范围选择
- ✅ getSelectedRows() 接口
- ✅ selectRow() 接口

#### 实现要点

```typescript
// 使用 TanStack Table 的行选择功能
const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getRowId: (row) => row[ROW_ID_FIELD],
  enableRowSelection: true,
  onRowSelectionChange: setRowSelection,
  state: {
    rowSelection,
  },
});
```

#### 验收标准

- [ ] 单击选择单行
- [ ] Ctrl/Cmd 多选生效
- [ ] Shift 范围选择生效
- [ ] 选中行高亮显示
- [ ] getSelectedRows() 返回正确的块索引

---

### 阶段 4：Status 列特殊渲染（预计 0.5 天）

**目标：** 实现 status 列的自定义渲染和交互

#### 功能范围

- ✅ Status 图标渲染（todo/done/inprogress/onhold/canceled）
- ✅ 左键点击切换状态（todo ↔ done）
- ✅ 右键显示状态菜单（5 种状态选择）
- ✅ 自动更新 statusChanged 时间戳

#### 实现要点

```typescript
// Status 列自定义 cell renderer
{
  id: 'status',
  cell: ({ row, getValue }) => {
    const status = normalizeStatus(getValue());
    return (
      <StatusCell
        status={status}
        onClick={() => handleStatusToggle(row.id)}
        onContextMenu={(e) => showStatusMenu(e, row.id)}
      />
    );
  },
}
```

#### 验收标准

- [ ] 图标正确显示
- [ ] 左键切换状态生效
- [ ] 右键菜单显示和交互正常
- [ ] done/canceled 状态行半透明

---

### 阶段 5：键盘导航（预计 1 天）

**目标：** 实现 Excel 风格的键盘导航

#### 功能范围

- ✅ Enter 键垂直导航
- ✅ Tab 键水平导航
- ✅ 方向键导航
- ✅ 编辑模式下 Enter 提交并移动
- ✅ 最后一行 Enter 自动新增行

#### 实现要点

```typescript
function handleKeyDown(e: KeyboardEvent, cell: Cell) {
  switch (e.key) {
    case 'Enter':
      if (!isEditing) {
        navigateDown();
      } else {
        saveAndNavigateDown();
      }
      break;
    case 'Tab':
      navigateRight();
      break;
    // ... 其他按键
  }
}
```

#### 验收标准

- [ ] Enter 键上下导航正常
- [ ] Tab 键左右导航正常
- [ ] 方向键导航正常
- [ ] 最后一行 Enter 触发新增行

---

### 阶段 6：复制粘贴（预计 0.5 天）

**目标：** 实现单元格复制粘贴

#### 功能范围

- ✅ Ctrl/Cmd + C 复制
- ✅ Ctrl/Cmd + V 粘贴
- ✅ 使用 Clipboard API
- ✅ 处理权限问题

#### 验收标准

- [ ] 复制单元格内容到剪贴板
- [ ] 粘贴剪贴板内容到单元格
- [ ] 不可编辑列不允许粘贴

---

### 阶段 7：排序和筛选（预计 1 天）

**目标：** 实现基础排序和筛选功能

#### 功能范围

- ✅ 点击表头排序（升序/降序/无序）
- ✅ 基础文本筛选
- ✅ 排序状态持久化（可选）

#### 实现要点

```typescript
const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  state: {
    sorting,
    columnFilters,
  },
});
```

#### 验收标准

- [ ] 点击表头触发排序
- [ ] 排序图标显示正确
- [ ] 筛选输入框正常工作
- [ ] 数据正确过滤

---

### 阶段 8：列宽调整（预计 0.5 天）

**目标：** 实现列宽拖拽调整

#### 功能范围

- ✅ 鼠标拖拽调整列宽
- ✅ 双击自动适应内容宽度
- ✅ 最小/最大宽度限制
- ✅ 列宽状态持久化（可选）

#### 实现要点

```typescript
// 使用 TanStack Table 的列大小调整功能
const table = useReactTable({
  // ...
  enableColumnResizing: true,
  columnResizeMode: 'onChange',
  state: {
    columnSizing,
  },
});
```

#### 验收标准

- [ ] 拖拽调整列宽正常
- [ ] 双击自动适应宽度
- [ ] 宽度限制生效

---

### 阶段 9：虚拟滚动（预计 1 天）

**目标：** 实现大数据量性能优化

#### 功能范围

- ✅ 行虚拟滚动
- ✅ 平滑滚动体验
- ✅ ensureIndexVisible 功能
- ✅ 性能测试（1000+ 行）

#### 实现要点

```typescript
// 使用 @tanstack/react-virtual
import { useVirtualizer } from '@tanstack/react-virtual';

const rowVirtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 40, // 估算行高
  overscan: 10, // 预渲染行数
});
```

#### 验收标准

- [ ] 1000 行数据流畅滚动
- [ ] 内存占用稳定
- [ ] 滚动位置正确

---

### 阶段 10：样式和主题（预计 1 天）

**目标：** 完善样式，深度适配 Obsidian 主题

#### 功能范围

- ✅ 亮色/暗色主题适配
- ✅ 表格边框、行间距、字体
- ✅ 选中状态、悬停状态
- ✅ 编辑状态样式
- ✅ 响应式布局

#### 实现要点

```css
/* 使用 CSS Variables 适配主题 */
.tlb-table {
  --table-border-color: var(--background-modifier-border);
  --table-bg: var(--background-primary);
  --table-row-hover: var(--background-modifier-hover);
  /* ... */
}
```

#### 验收标准

- [ ] 样式与 Obsidian 原生表格一致
- [ ] 亮色/暗色主题切换正常
- [ ] 各种状态样式正确

---

### 阶段 11：窗口调整大小处理（预计 0.5 天）

**目标：** 处理 Obsidian 窗口调整和新窗口场景

#### 功能范围

- ✅ 监听容器尺寸变化
- ✅ 调整表格布局和列宽
- ✅ 新窗口初始化正确
- ✅ 最大化/恢复正常工作

#### 验收标准

- [ ] 窗口调整大小表格正确响应
- [ ] 新窗口打开显示正常
- [ ] 最大化/恢复正常

---

### 阶段 12：测试和修复（预计 1-2 天）

**目标：** 全面测试，修复 bug 和边缘 case

#### 测试清单

- [ ] 功能测试（所有功能点）
- [ ] 交互测试（键盘、鼠标、右键菜单）
- [ ] 边缘 case（空数据、大数据、特殊字符）
- [ ] 性能测试（大数据量）
- [ ] 兼容性测试（Windows/Mac/Linux）
- [ ] 新窗口测试
- [ ] 主题切换测试

#### 验收标准

- [ ] 所有现有功能正常工作
- [ ] 无明显性能问题
- [ ] 无明显 bug

---

### 阶段 13：清理和发布（预计 0.5 天）

**目标：** 移除 AG Grid，清理代码

#### 任务清单

- [ ] 删除 AgGridAdapter.ts
- [ ] 删除 AG Grid 相关 CSS
- [ ] 卸载 ag-grid-community 依赖
- [ ] 更新 package.json
- [ ] 更新文档
- [ ] 合并到主分支

---

## 四、风险和应对

### 潜在风险

1. **功能遗漏**
   - 风险：AG Grid 有些隐藏功能可能被遗漏
   - 应对：详细记录 AgGridAdapter 的所有功能点，逐一对照

2. **性能问题**
   - 风险：手写 UI 可能不如 AG Grid 优化
   - 应对：早期引入虚拟滚动，性能测试

3. **样式问题**
   - 风险：样式适配可能不完美
   - 应对：充分利用 CSS Variables，参考 Obsidian 原生样式

4. **时间超期**
   - 风险：开发时间可能超出预期
   - 应对：分阶段验收，优先核心功能

---

## 五、时间估算

| 阶段 | 预计时间 | 说明 |
|------|---------|------|
| 阶段 0：准备工作 | 0.5 天 | 研究和设计 |
| 阶段 1：基础渲染 MVP | 1-2 天 | 核心功能 |
| 阶段 2：单元格编辑 | 1 天 | 核心功能 |
| 阶段 3：行选择 | 0.5 天 | 核心功能 |
| 阶段 4：Status 列 | 0.5 天 | 核心功能 |
| 阶段 5：键盘导航 | 1 天 | 重要功能 |
| 阶段 6：复制粘贴 | 0.5 天 | 重要功能 |
| 阶段 7：排序筛选 | 1 天 | 重要功能 |
| 阶段 8：列宽调整 | 0.5 天 | 次要功能 |
| 阶段 9：虚拟滚动 | 1 天 | 性能优化 |
| 阶段 10：样式主题 | 1 天 | 体验优化 |
| 阶段 11：窗口调整 | 0.5 天 | 兼容性 |
| 阶段 12：测试修复 | 1-2 天 | 质量保证 |
| 阶段 13：清理发布 | 0.5 天 | 收尾工作 |
| **总计** | **10-13 天** | **约 2 周** |

---

## 六、成功标准

### 功能完整性

- ✅ 所有 AgGridAdapter 的功能都已迁移
- ✅ TableView 业务逻辑无需修改
- ✅ 用户体验无降级

### 性能指标

- ✅ 1000 行数据流畅滚动（60fps）
- ✅ 编辑操作响应时间 < 100ms
- ✅ 内存占用稳定

### 代码质量

- ✅ 代码结构清晰，易于 AI 理解
- ✅ TypeScript 类型完整
- ✅ 无明显技术债

---

## 七、后续优化

迁移完成后，可以逐步优化的方向：

1. **性能优化**
   - 行高缓存优化
   - 滚动性能优化
   - 渲染优化（React.memo）

2. **功能增强**
   - 列拖拽排序
   - 列固定（freeze columns）
   - 单元格合并（如需要）

3. **体验优化**
   - 动画效果
   - 加载状态
   - 错误提示

---

## 八、参考资料

- [TanStack Table 官方文档](https://tanstack.com/table/v8)
- [TanStack Virtual 官方文档](https://tanstack.com/virtual/v3)
- [现有 AgGridAdapter 源码](../../src/grid/AgGridAdapter.ts)
- [GridAdapter 接口定义](../../src/grid/GridAdapter.ts)
