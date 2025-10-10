# T0016 - Excel 式单元格交互

**目标**：实现 Excel 风格的单元格选中和编辑分离

## 任务清单

- [x] 左键单击：只选中单元格，不进入编辑
- [x] 双击：进入编辑模式
- [x] ~~F2：进入编辑模式~~ （与 Obsidian 冲突，已放弃）
- [x] Enter：移动到下一行同一列
- [ ] 最后一行 Enter：新增一行并进入编辑（**有问题，待修复**）

## 已完成

1. **禁用单击编辑**：`singleClickEdit: false`
2. **Enter 键垂直导航**：配置 `enterNavigatesVertically` 和 `enterNavigatesVerticallyAfterEdit`
3. **最后一行 Enter 触发新增**：使用 `suppressKeyboardEvent` 拦截 Enter 键
4. **修复 AG Grid 警告**：
   - rowSelection 改用对象格式 `{mode: 'singleRow'}`
   - 移除 autoHeight 模式下的 resetRowHeights() 调用

## 待修复问题

### 问题1：最后一行 Enter 新增行后的行为异常

**现象**：
- ✅ 能够新增行
- ❌ 没有移动到新行（视图停留在原位置）
- ❌ 没有进入编辑状态
- ❌ 新增行后有奇怪的上下滚动动画（整个列表重新排序的效果）

**期望行为**：
- 新增行后直接跳转到新行
- 聚焦到新行的同一列
- 自动进入编辑状态
- 不应该有任何上下滚动的动画

**当前实现**：
```typescript
// src/TableView.ts:488
this.gridAdapter.onEnterAtLastRow?.((field) => {
  const oldRowCount = this.blocks.length;
  this.addRow(oldRowCount);

  const tryEdit = (attempt: number = 0) => {
    if (!this.gridAdapter || attempt > 5) return;
    const api = (this.gridAdapter as any).gridApi;
    if (!api) return;

    api.ensureIndexVisible(oldRowCount, 'bottom');
    api.startEditingCell({
      rowIndex: oldRowCount,
      colKey: field
    });

    // 重试逻辑
    setTimeout(() => {
      const editingCells = api.getEditingCells();
      if (editingCells.length === 0) {
        tryEdit(attempt + 1);
      }
    }, 50);
  };

  setTimeout(() => tryEdit(), 50);
});
```

**可能原因**：
- `updateData()` 可能触发了整个表格的重绘
- `ensureIndexVisible` 的时机不对或参数问题
- `startEditingCell` 的 rowIndex 可能不准确

### 问题2：AG Grid Warning #29

**警告信息**：
```
AG Grid: warning #29 tried to call sizeColumnsToFit() but the grid is coming back with zero width, maybe the grid is not visible yet on the screen?
```

**位置**：`src/grid/AgGridAdapter.ts:459`

**可能原因**：
- 在表格容器尺寸未确定时调用了 `sizeColumnsToFit()`
- 需要添加宽度检查或延迟调用

## 实现说明

### AG Grid 配置
```typescript
singleClickEdit: false,
enterNavigatesVertically: true,
enterNavigatesVerticallyAfterEdit: true,
rowSelection: { mode: 'singleRow' }
```

### suppressKeyboardEvent
在 `defaultColDef` 中拦截 Enter 键：
- 检测最后一行（无论选中还是编辑状态）
- 拦截 Enter 事件并触发新增行回调

## 相关文件
- `src/grid/AgGridAdapter.ts` - AG Grid 配置、suppressKeyboardEvent
- `src/TableView.ts` - 新增行后的聚焦和编辑逻辑
