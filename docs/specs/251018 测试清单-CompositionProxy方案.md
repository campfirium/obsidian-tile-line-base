# 251018 测试清单 - CompositionProxy 方案

**方案名称**：Composition Proxy Overlay（合成代理层）

**目标**：解决 AG Grid 按键启动编辑与 IME（输入法）冲突的问题

**参考文档**：
- `251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2.md`
- `251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2分析.md`

---

## 实现概要

### 核心原理

不要和浏览器的 IME 机制对抗，而是：
1. 在单元格上创建一个透明的 `contenteditable` 元素（代理层）
2. 首键落到已聚焦的代理层，IME 在此完成组合
3. 组合完成后，将文本写回 AG Grid 的真正编辑器

### 文件清单

1. **新增**：`src/grid/utils/CompositionProxy.ts` - 合成代理层类
2. **修改**：`src/grid/AgGridAdapter.ts` - 接入 CompositionProxy
3. **修改**：`src/grid/editors/TextCellEditor.ts` - 移除 eventKey/charPress 逻辑
4. **删除**：`src/grid/utils/ImeBuffer.ts` - 旧方案，已废弃

---

## 测试矩阵

### 基础用例（必须全部通过）

| 测试用例 | 操作步骤 | 预期结果 | 状态 |
|---------|---------|---------|------|
| **英文输入** | 在空单元格按 `a` | 编辑器打开，显示 `a` | ⬜ 待测 |
| **数字输入** | 在空单元格按 `1` | 编辑器打开，显示 `1` | ⬜ 待测 |
| **全拼输入** | 在空单元格输入 `ni`，选择"你" | 编辑器打开，显示"你" | ⬜ 待测 |
| **双拼输入** | 在空单元格输入 `n` `i`（双拼） | 编辑器打开，显示"你"（**不再是"吃"**） | ⬜ 待测 |
| **双击编辑** | 双击已有内容的单元格 | 编辑器打开，原值全选 | ⬜ 待测 |
| **Esc 取消** | 按首键后立即按 `Esc` | 不进入编辑，单元格保持未选中 | ⬜ 待测 |

### 复杂/边角用例

| 测试用例 | 操作步骤 | 预期结果 | 状态 |
|---------|---------|---------|------|
| **Pop-out 窗口** | 在 pop-out 窗口中重复基础用例 | 与主窗口一致 | ⬜ 待测 |
| **极慢输入** | 输入拼音，长时间停留在候选状态 | 候选窗锚定在单元格位置，最终正确上屏 | ⬜ 待测 |
| **快速连击** | 快速输入"北京"、"中华人民共和国" | 首字不丢，完整输入 | ⬜ 待测 |
| **候选选择** | 输入拼音，用数字键或方向键选择候选 | 候选正常响应，不被 AG Grid 拦截 | ⬜ 待测 |
| **候选窗位置** | 输入拼音，观察候选窗位置 | 候选窗锚定在单元格上方（或下方），不飞到屏幕外 | ⬜ 待测 |

### 回归测试（确保未破坏现有功能）

| 测试用例 | 操作步骤 | 预期结果 | 状态 |
|---------|---------|---------|------|
| **Enter 导航** | 在单元格按 `Enter` | 移动到下一行同列 | ⬜ 待测 |
| **最后一行 Enter** | 在最后一行按 `Enter` | 新增一行 | ⬜ 待测 |
| **Tab 导航** | 在编辑状态按 `Tab` | 提交并移动到右侧单元格 | ⬜ 待测 |
| **方向键导航** | 在非编辑状态按方向键 | 移动焦点 | ⬜ 待测 |
| **复制粘贴** | 选中单元格，Ctrl+C / Ctrl+V | 正常复制粘贴 | ⬜ 待测 |

---

## 测试步骤（推荐顺序）

### 1. 基础功能验证

1. 重载 Obsidian 插件（`Ctrl+Shift+I` 打开控制台，`Ctrl+R` 重载）
2. 打开包含 TileLineBase 表格的笔记
3. 按上述测试矩阵逐项测试

### 2. 双拼输入法测试（核心用例）

**操作步骤**：
1. 切换到**微软拼音**，启用**双拼**模式
2. 在空单元格上按 `n`
3. 观察：
   - 编辑器是否立即打开
   - 控制台日志：`[CompositionProxy] 激活代理层`
4. 继续按 `i`
5. 观察：
   - 候选窗是否弹出（应该显示"你"等候选）
   - 候选窗位置是否在单元格附近（**不是屏幕左上角或屏幕外**）
6. 选择候选（按空格或数字键）
7. 观察：
   - 控制台日志：`[CompositionProxy] compositionend - IME 组合结束`
   - 控制台日志：`[AgGridAdapter] 已将文本写回编辑器: 你`
   - 编辑器中应该显示"你"

**预期结果**：
- ✅ 编辑器显示"你"
- ❌ **不再**显示"吃"（这是之前的 bug）

### 3. Pop-out 窗口测试

**操作步骤**：
1. 在笔记右上角点击"更多选项"→"在新窗口中打开"
2. 在 pop-out 窗口中重复上述测试
3. 观察控制台日志，确认使用了正确的 `ownerDocument`

**预期结果**：
- ✅ Pop-out 窗口与主窗口行为一致
- ✅ 候选窗位置正确（在 pop-out 窗口的单元格上方）

### 4. 调试日志检查

打开浏览器控制台（`Ctrl+Shift+I`），观察以下日志：

**首键按下时**：
```
[AgGridAdapter] 可打印字符按下，启动 CompositionProxy
  key: n
  单元格矩形: { left: ..., top: ..., width: ..., height: ... }
[CompositionProxy] 激活代理层
  位置: { left: ..., top: ..., width: ..., height: ... }
[CompositionProxy] 已聚焦，等待输入...
```

**IME 组合时**：
```
[CompositionProxy] compositionstart - 开始 IME 组合
```

**IME 组合结束时**：
```
[CompositionProxy] compositionend - IME 组合结束
  event.data: 你
  textContent: 你
  最终文本: 你
[CompositionProxy] cleanup 完成
[AgGridAdapter] CompositionProxy 返回文本: 你
[AgGridAdapter] 已将文本写回编辑器: 你
```

**ASCII 快速路径**（英文/数字）：
```
[CompositionProxy] ASCII 快速路径触发，文本: a
[CompositionProxy] cleanup 完成
[AgGridAdapter] CompositionProxy 返回文本: a
[AgGridAdapter] 已将文本写回编辑器: a
```

---

## 已知限制与注意事项

### 候选窗锚点

- **问题**：某些系统/浏览器环境下，`opacity:0` 可能导致候选窗锚点偏移
- **解决**：当前使用"视觉透明"方案（`color: transparent` 等），不使用 `opacity:0`
- **验证**：测试时观察候选窗是否在单元格附近

### 滚动期间输入

- **当前状态**：未实现滚动跟随
- **影响**：如果用户在输入拼音期间滚动表格，候选窗锚点可能漂移
- **后续优化**：可在 `scroll` 事件中刷新代理层位置（见文档 §5）

### 合成期间的键盘事件

- **实现**：合成期间 `capturing = true`，所有键盘事件都被拦截
- **影响**：用户无法在合成期间用方向键导航、Enter 提交等
- **合理性**：这是正确的，方向键、Enter 等在 IME 中用于选择候选

---

## 问题排查

### 问题 1：首字符丢失

**症状**：双拼输入 `n` `i`，结果还是"吃"

**排查**：
1. 检查控制台日志，确认 `CompositionProxy` 是否被激活
2. 检查代理层是否聚焦（日志中应该有 `已聚焦，等待输入...`）
3. 检查 `compositionend` 事件是否触发
4. 检查 `event.data` 的值

### 问题 2：候选窗不弹出或位置错误

**症状**：候选窗不显示，或显示在屏幕左上角/外

**排查**：
1. 检查代理层的尺寸（日志中的 `位置` 字段）
2. 检查代理层的样式（不要设置 `display:none` 或 `visibility:hidden`）
3. 检查代理层的 `z-index`（应该是 `2147483647`）
4. 在控制台中手动查看代理层：
   ```js
   document.querySelector('[contenteditable="true"]')
   ```

### 问题 3：编辑器未打开

**症状**：按首键后编辑器不打开

**排查**：
1. 检查 `capturing` 标志是否被正确重置（`finally` 块）
2. 检查是否有异常抛出（控制台 Error 日志）
3. 检查 `startEditingCell` 是否被调用

### 问题 4：Pop-out 窗口失效

**症状**：在 pop-out 窗口中无法正常输入

**排查**：
1. 检查是否使用了正确的 `ownerDocument`（日志中应该有 `ownerDoc === document: false`）
2. 检查 `WeakMap` 是否正确维护了每个 Document 的代理层
3. 检查代理层是否被添加到了正确的 `document.body`

---

## 成功标准

**必须满足**：
- ✅ 双拼输入 `n` `i` → "你"（不再是"吃"）
- ✅ 候选窗正确显示并锚定在单元格附近
- ✅ Pop-out 窗口与主窗口行为一致
- ✅ 不破坏现有功能（Enter 导航、Tab 导航等）

**加分项**：
- ✅ ASCII 输入快速响应（32ms 内）
- ✅ 支持极慢输入（长时间停留候选状态）
- ✅ 控制台日志清晰，便于调试

---

## 后续优化方向

1. **滚动跟随**：在 `scroll` 事件中刷新代理层位置
2. **配置化**：提供 `editMode` 配置项（`key-press` / `double-click` / `F2`）
3. **多语言测试**：测试日文假名、韩文等其他 IME
4. **移动端**：测试 iOS/Android 软键盘（可选）

---

## 参考资源

- **设计文档**：`251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2分析.md`
- **实现代码**：
  - `src/grid/utils/CompositionProxy.ts`
  - `src/grid/AgGridAdapter.ts`（onCellKeyDown、suppressKeyboardEvent）
  - `src/grid/editors/TextCellEditor.ts`
- **业界对照**：Google Sheets 的 contenteditable overlay 方案
