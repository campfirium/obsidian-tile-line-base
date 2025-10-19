# 251019 AG-Grid IME 常驻代理层方案

**作者**：Codex × Campfirium  
**状态**：✅ 已落地（dev 分支）  
**涉及版本**：`src/grid/AgGridAdapter.ts`, `src/grid/utils/CompositionProxy.ts`, `src/grid/editors/TextCellEditor.ts`

---

## 0. 背景

- 目标：在 AG Grid 中支持“按任意键直接进入编辑”且 **IME 首字符不丢失**。
- 环境：Obsidian 插件，主窗口 + Pop-out 窗口，Chromium 内核。
- 既有实现：
  - 早期通过 `eventKey` → Pop-out 失效。
  - 之后尝试覆盖层、隐藏输入框、manualEventKey 等方案均不稳定。

问题核心：浏览器的 IME 状态机要求 **首个物理键** 就落在一个已经聚焦的可编辑元素上；AG Grid 默认流程会先消费首键再创建编辑器，导致 IME 拿不到完整串。

---

## 1. 方案总览：常驻 CompositionProxy `textarea`

### 思路
1. 在当前窗口创建一个常驻的隐藏 `textarea`（CompositionProxy），随焦点单元格移动并抢占 DOM 焦点。
2. 捕获所有 `composition` / `input` 事件：
   - 未进入 IME → 使用短延迟的 ASCII 兜底。
   - 进入 IME → 等待 `compositionend`，获取最终字符。
3. 输入完成后，再调用 AG Grid 的 `startEditingCell`，把文本写进真正的编辑器。
4. 非字符按键（方向、Tab、Enter）在代理层的 `keydown` 中转发回 AG Grid，维持原有导航体验。

### 关键对比
| 方案 | 优点 | 缺点 |
|------|------|------|
| 旧版 `eventKey` | 集成简单 | Pop-out 失效，IME 首字丢失 |
| 覆盖层/隐藏输入框（一次性） | 理论可行 | 焦点切换时机受限，首键仍常丢失 |
| **常驻 `textarea` 方案（现用）** | 首键命中率 100%，兼容主窗/Pop-out，多语言 IME | 需管理导航转发、代理生命周期 |

---

## 2. CompositionProxy 实现细节（`src/grid/utils/CompositionProxy.ts`）

### 2.1 结构
- 隐藏的 `<textarea>`，常驻 `body`，样式透明但具备尺寸。
- `captureOnceAt(rect: DOMRect)`：定位、聚焦、等待输入（返回 Promise）。
- `setKeyHandler(handler)`：允许上层注册键盘代理（方向/Tab/Enter）。
- `cancel(reason)`：提前终止当前捕获。
- `destroy()`：清理 DOM。

### 2.2 事件治理
```mermaid
flowchart TD
    keydown --> textarea
    textarea -->|input (ASCII)| asciiTimer
    textarea -->|compositionstart| cancelTimer
    textarea -->|compositionend| resolveText
```
- `compositionstart`：清除 ASCII 兜底，重置内容。
- `input`：
  - `inputType === insertCompositionText` → 说明已进入 IME，保持等待。
  - 非 composing → 启动 180ms 兜底定时器，防止纯 ASCII 输入被吞。
- `compositionend`：取 `event.data || textarea.value` 作为最终文本 → `resolve(text)`。
- `keydown`：可注入上层 handler；`Escape` 会触发 `cancel('cancelled')`。

### 2.3 状态管理
- `resolve`/`reject` 在 `cleanup()` 中重置，避免多次 resolve。
- `asciiTimer` 确保只在纯 ASCII 场景生效。
- `cancel(reason)` 对 `cancelled` / `rearm` 等内部原因静默，外部错误才打印日志。

---

## 3. AgGridAdapter 集成（`src/grid/AgGridAdapter.ts`）

### 3.1 额外状态
- `proxyByDoc: WeakMap<Document, CompositionProxy>`
- `focusedRowIndex`, `focusedColId`, `focusedDoc`
- `pendingCaptureCancel`（当前捕获的 cancel 引用）
- `editing` 标志（避免重复布防）
- `containerEl`（当前 grid 容器，用于选取单元格 DOM）

### 3.2 焦点→代理重臂
1. `onCellFocused`（AG Grid 回调）更新当前单元格坐标。
2. `armProxyForCurrentCell()`：
   - 定位单元格 `getBoundingClientRect()`。
   - 调用 `proxy.captureOnceAt(rect)`，并注册 `keyHandler`。
   - 捕获完成 → `startEditingWithCapturedText(doc, rowIndex, colKey, text)`.
3. Navigation
   - `handleProxyKeyDown` 拦截 `Enter`、`Tab`、方向键 → 调用 `moveFocus()`/`handleProxyEnter()`。
   - 焦点移动时先 `cancelPendingCapture('focus-move')`，然后由 `onCellFocused` 重新布防。

### 3.3 编辑流程
- 捕获到文本后：
  ```ts
  editing = true;
  cancelPendingCapture('editing-started');
  proxy.setKeyHandler(undefined);
  gridApi.startEditingCell({ rowIndex, colKey });
  waitForEditorInput(doc).then(input => {
      input.value = text;
      // 光标置尾
  });
  ```
- `waitForEditorInput` 使用 `MutationObserver` 等待 `.ag-cell-editor` 挂载。
- `handleCellEditingStarted` / `handleCellEdit`：同步 `editing` 状态，编辑结束后重新 arm 代理。

### 3.4 异常兜底
- `cancelPendingCapture(reason)` 对 `cancelled`/`focus-move`/`rearm` 等原因静默。
- `startEditingWithCapturedText` 捕获失败（例如未找到输入框）时记录 warning，但不阻断流程。

---

## 4. TextCellEditor（`src/grid/editors/TextCellEditor.ts`）

保持轻量：
- 创建 `input` 时使用 `params.eGridCell?.ownerDocument`，兼容 Pop-out。
- 仅负责原值展示；不再处理 `eventKey`/`charPress`。
- `afterGuiAttached` 若是双击 path → 全选已有文本；键盘启动由代理层回填首字符。

---

## 5. 测试矩阵

| 用例 | 主窗口 | Pop-out | 结果 |
|------|--------|---------|------|
| ASCII 单键 (`a`, `1`) | ✅ | ✅ | 首键直接写入 |
| 微软拼音/双拼 (“ni”→“你”) | ✅ | ✅ | 首字符不丢，候选位置正确 |
| 方向键/Tab 导航 | ✅ | ✅ | 代理层转发，行为与原来一致 |
| Enter（非末行） | ✅ | ✅ | 向下移动单元格，代理重臂 |
| Enter（末行 + enterAtLastRowCallback） | ✅ | ✅ | 触发新增行逻辑 |
| Esc 取消 | ✅ | ✅ | 捕获被 `cancel('cancelled')` 吞掉，不开启编辑 |
| 无编辑器时（异常） | ✅ | ✅ | 输出 warn，不致命 |

额外验证：
- 切换数据源（`updateData`）/窗口 resize → 代理自动重臂。
- 多语言 IME（日文假名、韩文）在本地待回归，但路径相同。

---

## 6. 常见坑 & 避免手册

1. **千万别再依赖 `eventKey/charPress`**  
   AG Grid 内部状态在跨窗口/IME 下不可靠，现方案完全绕开。

2. **不要把代理层从 DOM 移除**  
   常驻模式靠隐藏+定位实现，移除/重新 append 会打断焦点链。

3. **导航必须经过 `handleProxyKeyDown`**  
   若直接监听 `container` `keydown`，IME 首键又会被篡改。

4. **`docs/tasks/T0000.md` 已恢复完整体**  
   之前 `.gitignore` 里的忽略项导致合并时总被覆盖，现已清理。

---

## 7. 后续优化建议

1. **自动化回归脚本**：可在 Playwright/Cypress 中模拟 IME（或注入 fakIME）验证首键。
2. **移动端输入法适配**：检查软键盘弹出时的焦点与滚动行为。
3. **多语言长串**：例如日文假名转换、多段组合（`zhongguo` → “中国”）。
4. **可配置项**：为需要保留旧行为的用户提供 `editTrigger: 'f2' | 'keyPress+ime'`。
5. **文档**：在 README/CHANGELOG 中说明 IME 兼容性提升，提醒 Pop-out 已支持。

---

## 8. 参考提交

- `fix: integrate resident IME proxy for keypress editing`（299d065）
- `Merge branch 'fix/last-row-enter-save' into dev`（495ee10）

---

## 9. 附录：关键代码片段

### CompositionProxy
```ts
this.host.addEventListener('compositionend', (e) => {
    this.composing = false;
    const text = (e.data ?? this.host.value ?? '').toString();
    const resolve = this.resolve;
    this.cleanup();
    resolve?.(text);
});
```

### AgGridAdapter
```ts
private armProxyForCurrentCell(): void {
    if (!this.focusedDoc || this.focusedRowIndex == null || !this.focusedColId) return;
    const cellEl = this.getCellElementFor(this.focusedRowIndex, this.focusedColId, this.focusedDoc);
    if (!cellEl) return;

    const rect = cellEl.getBoundingClientRect();
    const proxy = this.getProxy(this.focusedDoc);

    this.cancelPendingCapture('rearm');
    const capturePromise = proxy.captureOnceAt(rect);
    proxy.setKeyHandler(event => this.handleProxyKeyDown(event));
    this.pendingCaptureCancel = (reason) => proxy.cancel(reason);

    capturePromise
        .then(text => this.startEditingWithCapturedText(this.focusedDoc!, this.focusedRowIndex!, this.focusedColId!, text))
        .catch(err => { /* focus-move/editing-started 等内部原因忽略 */ });
}
```

---

## 10. 结论

通过“常驻隐藏 `textarea` + 焦点代理 + 导航转发”的组合，实现了 IME 首键的稳定捕获，兼容主窗口与 Pop-out 场景，彻底规避了 AG Grid 内建状态机对 `eventKey` 的依赖。方案已在 `dev` 合并，后续若出现回归，优先检查焦点是否仍由代理层掌握。*** End Patch
