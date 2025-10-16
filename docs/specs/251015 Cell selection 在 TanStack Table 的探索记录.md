# 251015 Cell selection 在 TanStack Table 的探索记录

**日期**：2025-10-15  
**作者**：AI 协作日志  
**上下文**：feat/switch-to-tanstack-table 分支  
**相关 commit**：`d9f1f2d4` （恢复到稳定版本前的 Git 头）

---

## 1. 目标与动机

- 将 AG Grid 的“单元格焦点/高亮”体验迁移到 TanStack Table v8。
- 期望行为：
  1. 单击单元格 → 既保持现有的行选中，又高亮该单元格。
  2. 双击单元格 → 立即进入编辑模式（不可要求多次点击）。
  3. 状态列左键切换、右键菜单依旧一次触发。
  4. 为后续方向键、Tab/Enter 键盘导航铺路。

在 AG Grid 时代，这些行为由组件内部实现；换用 TanStack Table（headless）后，需要自行组合状态。

---

## 2. 尝试过程与失败原因

### 2.1 第一次尝试：直接在现有 onClick 中追加 `setFocusedCell`

- **改动**：在单元格 `onClick` 末尾附带 `setFocusedCell`，并在 CSS 中增加 `.tlb-cell-focused`。
- **现象**：
  - 状态列左键切换需要“点两次”才生效。
  - 双击可编辑单元格偶尔不进入编辑，表现为“先高亮、再双击才响应”。
  - 单元格高亮没有出现（实测是类名未绑定成功 & 样式优先级不足）。
- **排查**：
  - 事件冒泡顺序：我们在 `onClick` 中同时处理“行选 + 焦点 + 双击判断”，当状态列触发 `setCellValue` 时， TanStack Table 自己的状态更新又触发重渲染，导致我们手动设置的 focus 状态被抢。
  - CSS 未加载：`.tlb-cell-focused` 只写了 `outline`，但 `<td>` 默认 `outline: none`。未结合表格作用域，样式很容易被 Obsidian 主题覆盖。
  - 由于 `focusCell` 写在 `onClick` 前半段，双击判断逻辑被提前 `return`，导致编辑函数不再触达。
- **结果**：产生严重交互回归，被立即回滚至稳定版本 (`03c4c9a`)。

### 2.2 第二次尝试：提取 `focusCell` 辅助函数

- **改动**：仿照社区示例，新增 `focusedCellId` 状态 + `getCellId/focusCell` 工具；在 `onClick` 最后调用 `focusCell`，随后再做“若双击则编辑”判断。
- **现象**：
  - 状态列单击仍需两次才能切换（推测是焦点更新之后又触发状态列的内部 `updateData`，第二次点击才落地）。
  - 依然没有肉眼可见的单元格描边（真实原因：我们在 `<td>` 加了类，却忘记更新 CSS；后续尝试补上 `box-shadow` 仍然被覆盖）。
  - 由于双击判断放在 `focusCell` 之后，React 在同一事件内会共享 `click`/`dblclick`，处理顺序不确定，导致偶尔只执行行选/焦点而未执行编辑。
- **结果**：交互回归再次出现，被再次回滚。

### 2.3 第三次尝试：引用在线范例直接移植

- **参考**：TanStack 社区的 Codesandbox / GitHub 示例（见第 4 节）。
- **做法**：
  - 完整照搬 `focusedCellId` 状态 + `className` 拼接 + `box-shadow` 样式。
  - 在 `onClick` 内执行顺序：（1）原行选逻辑，（2）`focusCell`，最后（3）双击开编辑。
- **现象**：
  - 行选高亮正常；双击编辑恢复正常。
  - 单元格描边依旧没有出现，原因分析：
    1. 目前 CSS 仍是全局样式而非 scoped，`box-shadow`/`outline` 可能被 Obsidian 主题覆盖。
    2. `<td>` 上我们没有阻止 `mousedown` 冒泡，TanStack 的行选在 `mousedown` 时就先更新一次，随后的 `click` 又触发一次，`focusedCellId` 在一次事件里频繁改写，导致最末状态被覆盖为“空”。
  - 日志里出现“Status 列单击需要两次”的问题说明事件顺序仍有冲突。
- **结果**：为避免影响现有行为，再次回退到基线版本。

---

## 3. 暂停原因与待办

1. **样式未生效**：  
   - 需要确认 Obsidian 主题下 `<td>` 的实际层叠，是否需要写成 `.tlb-table td.tlb-cell-focused` 或者添加更高优先级的 `!important`。  
   - 目前只是全局 CSS，尚未命中目标元素。

2. **事件顺序冲突**：  
   - TanStack 的行选在 `mousedown` 阶段就更新，而我们在 `click` 阶段再设置焦点，可能造成状态在同一事件里多次切换。  
   - 状态列单击之所以要点两次，很像是第一次被焦点逻辑吞掉 `preventDefault` 或者 `stopPropagation` 位置不对。

3. **键盘需求未搭建**：  
   - 未能稳定高亮单元格之前，方向键/Enter/Tab 的实现无法推进。

4. **当前决策**：  
   - 暂时回滚到稳定版本（无单元格高亮，仅行选择）。  
   - 将问题记录在案，待重新设计事件顺序与样式方案后再实现。

---

## 4. 外部参考资料

| 资料名称 | 链接 | 备注 |
| --- | --- | --- |
| TanStack Table – Focus & Selection 文档 | https://tanstack.com/table/v8/docs/api/features/row-selection | 官方强调仅提供 rowSelection，其他交互需自定义 |
| StackOverflow: *How to implement cell selection in TanStack Table?* | https://stackoverflow.com/questions/76191583/how-to-implement-cell-selection-in-tanstack-table | 被采纳的答案就是“自维护 state + className” |
| 示例：tanstack-table-examples（row + cell selection） | https://github.com/mikecousins/tanstack-table-examples | 行 + 单元格并行管理的示例 |
| 示例：TanStack Table cell focus (CodeSandbox) | https://codesandbox.io/s/tanstack-table-cell-focus | 带键盘导航的完整 demo |

---

## 5. 下一步建议

1. **重构事件顺序**  
   - 参照示例，在 `onMouseDown` 阶段阻止冒泡，`onClick` 只做焦点/编辑逻辑。  
   - 对状态列额外处理：左键时直接调用 `focusCell`，避免焦点状态缺失。

2. **加强 CSS 命中**  
   - 使用 `.tlb-table tbody td.tlb-cell-focused` 之类的选择器确保优先级。  
   - 结合 `outline` 与背景色测试，必要时使用 `!important` 或自定义主题变量。

3. **验证策略**  
   - 每次改动都先在“普通列”“状态列”分别测试单击/双击。  
   - 引入自动化单元测试（如 Testing Library）验证事件顺序，避免重复手测。

4. **完成后再推进键盘导航**  
   - 单元格焦点稳定后，再实现方向键/Enter/Tab，否则容易引发同类问题。

---

> **总结**  
> TanStack Table 不提供内置的单元格选择，需要我们自行维护状态与样式。本次尝试多次造成双击编辑与状态列操作回归，因此先回滚至稳定版本并记录问题。后续按照上述建议重新设计事件顺序与 CSS，使行选与单元格高亮真正共存，再继续阶段 5（键盘导航）。
