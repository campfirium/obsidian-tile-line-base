# T0044 过滤视图刷新问题分析与解决方案

## 问题描述

在过滤视图中,当进行以下操作时,新内容显示不及时:
- 复制行
- 新增行
- 修改数据

需要切换到文件视图再切回来才能正常显示更新的内容。

## 根本原因分析

### 数据流架构

TableView 中存在**两个关键的数据缓存层**:

1. **`this.blocks`** (src/TableView.ts:44)
   - H2 块数组,从 Markdown 文件解析而来
   - 是数据的**唯一真实来源**(Single Source of Truth)
   - 所有数据修改操作都直接更新这个数组

2. **`this.allRowData`** (src/TableView.ts:48, :593)
   - 完整的表格数据快照,用于过滤视图
   - 在 `render()` 时通过 `extractTableData(this.blocks, this.schema)` 生成
   - 过滤视图从这里读取数据并应用过滤规则

### 问题所在

当执行数据修改操作时(复制/新增/编辑),代码会:
- ✅ 更新 `this.blocks`
- ✅ 调用 `this.gridAdapter?.updateData(data)` 更新 AG Grid 显示
- ❌ **但没有同步更新 `this.allRowData`!**

这导致:
- 在"全部"视图下,直接调用 `updateData()`,数据能正常显示
- 但在过滤视图下,`applyActiveFilterView()` 仍然使用**旧的** `this.allRowData`,所以新数据看不到
- 只有切换到文件视图再切回来,才会重新执行 `render()`,重新生成 `allRowData`

### 受影响的代码位置

1. **`onCellEdit()` (src/TableView.ts:1281-1313)**
   ```typescript
   block.data[field] = newValue;  // ✅ 更新 blocks
   // ❌ 缺少: 同步 allRowData 和重新应用过滤视图
   this.scheduleSave();
   ```

2. **`addRow()` (src/TableView.ts:1372-1428)**
   ```typescript
   this.blocks.splice(beforeRowIndex, 0, newBlock);  // ✅ 更新 blocks
   const data = this.extractTableData(this.blocks, this.schema);  // ✅ 提取新数据
   this.gridAdapter?.updateData(data);  // ✅ 更新 Grid
   // ❌ 缺少: this.allRowData = data; 和重新应用过滤视图
   ```

3. **`duplicateRow(s)` (src/TableView.ts:1529-1612)**: 同样的问题

4. **`deleteRow(s)` (src/TableView.ts:1460-1527)**: 同样的问题

## 解决方案

### 设计思路

1. **统一数据更新入口**: 创建一个 `refreshGridData()` 方法
2. **同步 allRowData**: 每次从 `blocks` 重新提取完整数据
3. **重新应用过滤视图**: 如果有激活的过滤视图,自动重新应用过滤规则

### 实现方案

#### 1. 新增核心方法 `refreshGridData()`

```typescript
/**
 * 刷新表格数据（同步 allRowData 并重新应用过滤视图）
 * 所有数据修改操作（增删改）后都应该调用此方法
 */
private refreshGridData(): void {
    if (!this.schema || !this.gridAdapter) {
        return;
    }

    // 从 blocks 重新提取完整数据
    this.allRowData = this.extractTableData(this.blocks, this.schema);

    // 根据当前激活的过滤视图决定显示哪些数据
    const targetId = this.filterViewState.activeViewId;
    const targetView = targetId
        ? this.filterViewState.views.find((view) => view.id === targetId) ?? null
        : null;

    let dataToShow: any[];
    if (!targetView || !targetView.filterRule) {
        // 没有激活视图，显示全部数据
        dataToShow = this.allRowData;
    } else {
        // 应用过滤规则
        dataToShow = this.applyFilterRule(this.allRowData, targetView.filterRule);
    }

    // 更新 AG Grid 显示
    this.gridAdapter.updateData(dataToShow);
}
```

#### 2. 修改所有数据修改操作

将以下方法中的:
```typescript
const data = this.extractTableData(this.blocks, this.schema);
this.gridAdapter?.updateData(data);
```

替换为:
```typescript
this.refreshGridData();
```

受影响的方法:
- `onCellEdit()`: 单元格编辑后调用
- `addRow()`: 新增行后调用
- `deleteRow()`: 删除行后调用
- `deleteRows()`: 批量删除后调用
- `duplicateRow()`: 复制行后调用
- `duplicateRows()`: 批量复制后调用

### 优势

1. **统一性**: 所有数据修改都走同一个刷新流程,避免遗漏
2. **正确性**: 确保 `allRowData` 始终与 `blocks` 保持同步
3. **完整性**: 自动处理过滤视图的重新应用,无需手动切换
4. **可维护性**: 未来新增数据修改操作时,只需调用 `refreshGridData()` 即可

## 修改进度

- [x] 添加核心方法 `refreshGridData()`
- [ ] 修改 `onCellEdit()`
- [ ] 修改 `addRow()`
- [ ] 修改 `deleteRow()`
- [ ] 修改 `deleteRows()`
- [ ] 修改 `duplicateRow()`
- [ ] 修改 `duplicateRows()`
- [ ] 测试各种场景

## 测试计划

修改完成后需要测试以下场景:

1. **在"全部"视图下**:
   - 新增行 → 应立即显示
   - 复制行 → 应立即显示
   - 编辑单元格 → 应立即更新
   - 删除行 → 应立即消失

2. **在过滤视图下**:
   - 新增符合过滤条件的行 → 应立即显示
   - 新增不符合过滤条件的行 → 不应显示,但切换到"全部"应能看到
   - 编辑单元格使其不再符合过滤条件 → 应立即从视图中消失
   - 编辑单元格使其符合过滤条件 → 应立即出现在视图中
   - 复制行 → 应立即显示(如果符合过滤条件)
   - 删除行 → 应立即消失

3. **切换视图**:
   - 在过滤视图 A 修改数据 → 切换到过滤视图 B → 数据应正确显示
   - 在过滤视图修改数据 → 切换到"全部" → 所有数据应正确显示
