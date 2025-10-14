# T0022-cell-copy-paste

## 积木编号
**Building Block 22 / N**

## 目标
为 TileLineBase 表格视图实现单个单元格的复制粘贴功能，利用 AG Grid 社区版自带的复制粘贴能力，为用户提供流畅的表格编辑体验。

## 背景
- 当前表格视图已经集成了 AG Grid 社区版，但尚未启用单元格复制粘贴功能。
- AG Grid 社区版提供了基础的复制粘贴功能，通过配置 `enableCellTextSelection` 和剪贴板 API 即可实现。
- 需要确保复制粘贴操作能正确写回 Markdown 文件。

## 功能需求

### 基础功能
1. **单元格复制**
   - 用户选中单元格后，使用 Ctrl+C（Windows/Linux）或 Cmd+C（macOS）复制内容
   - 复制的内容以纯文本格式保存到系统剪贴板

2. **单元格粘贴**
   - 用户选中单元格后，使用 Ctrl+V（Windows/Linux）或 Cmd+V（macOS）粘贴内容
   - 粘贴内容会更新单元格的值
   - 更新后的值需要写回到 Markdown 文件

3. **文本选择**
   - 支持在单元格内选择文本进行复制
   - 光标可以自由定位在单元格文本中

## 任务拆分

### T0022-1：研究 AG Grid 社区版复制粘贴 API
- 查阅 AG Grid 官方文档，了解社区版的复制粘贴功能
- 确认需要配置的属性：`enableCellTextSelection`, `enableRangeSelection`, `copyHeadersToClipboard` 等
- 了解剪贴板事件的处理方式

### T0022-2：配置 AG Grid 复制粘贴选项
- 在 `TableView.ts` 的 `setupGrid` 方法中添加复制粘贴相关配置
- 启用单元格文本选择功能
- 配置剪贴板处理选项

### T0022-3：实现数据写回逻辑
- 确保 `onCellValueChanged` 事件能正确处理粘贴后的数据变更
- 验证数据写回 Markdown 文件的流程
- 处理特殊字符和格式

### T0022-4：测试复制粘贴功能
- 测试单元格内文本选择和复制
- 测试跨单元格复制粘贴
- 测试与系统其他应用之间的复制粘贴
- 验证数据正确写回文件

## 验收标准
1. 用户可以使用标准快捷键（Ctrl+C/Cmd+C）复制单元格内容
2. 用户可以使用标准快捷键（Ctrl+V/Cmd+V）粘贴内容到单元格
3. 粘贴的内容能正确更新表格显示
4. 更新的数据能正确写回 Markdown 文件
5. 复制粘贴操作不影响其他表格功能
6. 代码通过 `npm run build`

## 依赖与风险
- 依赖：T0008（AG Grid 集成）、T0007（写回文件）功能稳定
- 风险：需要确保 AG Grid 社区版的复制粘贴功能满足需求，如果不够强大可能需要自定义实现

---

## 实现尝试记录

### 尝试 1：基础配置 + 企业版 API（失败）
**时间**: 2025-10-14

**配置**:
```typescript
// src/grid/AgGridAdapter.ts
enableCellTextSelection: true,
suppressCopyRowsToClipboard: false,
suppressCopySingleCellRanges: false,
processCellForClipboard: (params) => params.value ?? '',
processCellFromClipboard: (params) => params.value ?? '',
```

**结果**: 编译通过，但无法复制。

**分析**: 查阅文档后发现：
- `processCellForClipboard` 和 `processCellFromClipboard` 是企业版（Enterprise）功能
- 社区版虽然有这些 API，但可能不完全工作
- 缺少关键配置 `enableRangeSelection`

**参考**:
- https://www.ag-grid.com/javascript-data-grid/clipboard/
- Stack Overflow: AG Grid 社区版需要 `enableRangeSelection` 才能复制

### 尝试 2：添加 enableRangeSelection（失败）
**时间**: 2025-10-14

**新增配置**:
```typescript
enableRangeSelection: true,  // 启用单元格范围选择
```

**结果**: 编译通过，但仍然无法复制。

**分析**:
- `enableRangeSelection` 是复制粘贴的前提条件（社区版必需）
- 在社区版中，必须通过鼠标拖动创建范围选区（不是行选择）
- 企业版的 `process*` 回调可能与社区版冲突

### 尝试 3：移除企业版 API，只保留社区版配置（当前）
**时间**: 2025-10-14

**最终配置**:
```typescript
// src/grid/AgGridAdapter.ts:309-414
enableRangeSelection: true,           // 必需：启用单元格范围选择
enableCellTextSelection: true,        // 允许选择单元格文本
suppressClipboardPaste: false,        // 确保粘贴功能未被禁用
```

**移除的配置**:
- `suppressCopyRowsToClipboard`
- `suppressCopySingleCellRanges`
- `processCellForClipboard`
- `processCellFromClipboard`

**结果**: 编译通过，用户反馈：**仍然无法复制**

**使用方法**（社区版特定）:
1. 用鼠标点击并拖动选择单元格范围（会看到蓝色选区）
2. 按 Ctrl+C 复制
3. 点击目标单元格（不要进入编辑模式）
4. 按 Ctrl+V 粘贴

**限制**:
- 只能复制/粘贴可编辑的单元格（`#` 和 `status` 列无法粘贴）
- 必须通过鼠标拖动创建范围选区
- 粘贴时单元格不能处于编辑模式

**根本原因分析** ⚠️:
1. ✓ AG Grid 版本：v34.2.0（最新版本）
2. ✓ 键盘事件拦截：`suppressKeyboardEvent` 只处理 Enter 键，不影响 Ctrl+C/V
3. ❌ **核心问题：功能超纲**
   - `enableRangeSelection` 是 **Enterprise 特性**，社区版不支持
   - Excel 式的单元格选择和网格级剪贴板属于企业模块
   - `processCellForClipboard/processCellFromClipboard` 在 `@ag-grid-enterprise/clipboard` 包中
   - `enableCellTextSelection: true` 会**禁用**网格剪贴板，只复制选中文本

**参考文档**:
- [Cell Selection (Enterprise)](https://www.ag-grid.com/javascript-data-grid/cell-selection/)
- [Cell Text Selection (Community)](https://www.ag-grid.com/javascript-data-grid/cell-text-selection/)
- [@ag-grid-enterprise/clipboard](https://www.npmjs.com/package/@ag-grid-enterprise/clipboard)

**可行方案**:
- ❌ **方案 A**：在编辑态内粘贴（体验差）
- ✅ **方案 B**：自定义剪贴板逻辑（推荐）
  - 使用 `onCellKeyDown` 拦截 Ctrl+C/V
  - 使用 `navigator.clipboard` API
  - 通过 `api.getFocusedCell()` 和 `setDataValue()` 操作单元格
  - 利用现有的 `onCellValueChanged` 自动写回文件
- ⚠️ **方案 C**：升级到 Enterprise（需要许可证）

### 尝试 4：自定义剪贴板逻辑（方案 B）（当前）
**时间**: 2025-10-14

**实现思路**:
```typescript
// src/grid/AgGridAdapter.ts:409-472
onCellKeyDown: (params: any) => {
  const keyEvent = params.event as KeyboardEvent;
  const isCtrlOrCmd = keyEvent.ctrlKey || keyEvent.metaKey;

  // Ctrl+C: 复制聚焦单元格的值
  if (isCtrlOrCmd && keyEvent.key === 'c') {
    const focusedCell = api.getFocusedCell();
    const rowNode = api.getDisplayedRowAtIndex(focusedCell.rowIndex);
    const cellValue = rowNode.data?.[focusedCell.column.getColId()];
    navigator.clipboard.writeText(String(cellValue ?? ''));
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
  }

  // Ctrl+V: 粘贴到聚焦单元格
  if (isCtrlOrCmd && keyEvent.key === 'v') {
    const focusedCell = api.getFocusedCell();
    const rowNode = api.getDisplayedRowAtIndex(focusedCell.rowIndex);
    const colId = focusedCell.column.getColId();
    const colDef = focusedCell.column.getColDef();

    // 检查是否可编辑
    if (colDef.editable === false) return;

    navigator.clipboard.readText().then((text) => {
      rowNode.setDataValue(colId, text);  // 会触发 onCellValueChanged
      api.refreshCells({ rowNodes: [rowNode], columns: [colId] });
    });
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
  }
}
```

**移除的错误配置**:
- `enableRangeSelection: true` (企业版功能)
- `enableCellTextSelection: true` (会禁用网格剪贴板)
- `suppressClipboardPaste: false` (无效配置)

**关键技术点**:
1. 使用 `navigator.clipboard` 浏览器 API 直接操作剪贴板
2. 通过 `api.getFocusedCell()` 获取当前聚焦单元格
3. 使用 `rowNode.setDataValue()` 更新值，自动触发 `onCellValueChanged` 写回文件
4. `preventDefault()` 和 `stopPropagation()` 防止 Obsidian/Electron 拦截快捷键
5. 检查 `editable` 属性，只允许粘贴到可编辑列

**结果**: 等待用户测试

---

**预计工作量**：1 ~ 2 小时（实际：已花费 3+ 小时）
**优先级**：中（提升用户编辑体验的重要功能）
**状态**：🧪 待测试 - 已实现自定义剪贴板逻辑（方案 B）
