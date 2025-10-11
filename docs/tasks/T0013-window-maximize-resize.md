# T0013：新窗口最大化未触发列宽调整

## 积木编号
**Building Block 13 / N**

## 目标
确保 TileLineBase 视图在被移动到 Obsidian 新窗口后，点击「最大化」能够即时触发表格列宽的自动调整，不再需要手动拖动窗口。

## 背景
- `.claude/todo.md` 记录：Windows 上将视图移至新窗口并最大化时，日志中看不到 `ResizeObserver` 或 `window resize` 回调；手动拖动窗口尺寸才恢复正常。
- `src/TableView.ts:571-642` 当前只依赖 `ResizeObserver` 和 `ownerWindow.addEventListener('resize', …)`，并安排数次延迟重算列宽。
- 类内部已声明 `sizeCheckInterval` / `lastContainerWidth` 等字段，但尚未接入实际逻辑。

## 问题分析

### 现象
1. 初次渲染或拖动窗口 → `ResizeObserver` 正常输出宽高变化，列宽自动收敛。
2. 点击最大化按钮 → 无 `window resize`/`ResizeObserver` 日志，表格仍保持最大化前的宽度。
3. 再次拖动窗口尺寸 → 监听器恢复，列宽立即更新。

### 初步推测
- Electron 在 `BrowserWindow.maximize()` 时可能跳过了 DOM 层的 `resize` 分发，仅通过内部 IPC 更新布局。
- Obsidian 新窗口的 `tableContainer.ownerDocument.defaultView` 打印为 `global { window: global, … }`，提示事件挂载在 polyfilled window，而非最终呈现的渲染容器。
- `ResizeObserver` 对快速切换最大化/还原的场景可能不稳定，容器先临时脱离文档流，再以 transform 或 zoom 方式还原。

## 任务拆分

### T0013-1：调查替代监听渠道
- 验证 `visualViewport.addEventListener('resize')` 是否在最大化时触发。
- 探索 Obsidian API：`app.workspace.on('resize', handler)`、`workspace.on('window-open', …)` 等事件能否覆盖。
- 记录不同平台（Windows/macOS/Linux）与主题模式下的回调行为。

### T0013-2：实现多通道监听与兜底轮询
- 在 `setupResizeObserver` 中接入新的监听渠道，调用 `scheduleColumnResize`。
- 补全 `sizeCheckInterval` 逻辑：设定 300~500ms 间隔对 `offsetWidth/offsetHeight` 采样，检测到变化时触发一次列宽重算；需做 150ms 防抖与最大重试次数限制，避免抖动。
- 确保新增监听均在 `cleanupEventListeners` 内清理，防止内存泄漏或重复挂载。

### T0013-3：验证与记录
- 在 Windows 上执行最大化、还原、拖动、显示器 DPI 切换等场景验证列宽行为。
- 若可能，邀请 macOS / Linux 同事复测或记录待验证项。
- 更新 `.claude/todo.md` 中的测试结论，并在 specs/ 或 README 的「已知问题」中补充说明（若仍有边界情况）。

## 验收标准
1. 新窗口最大化/还原时，无需手动拖动就能看到列宽同步调整，日志包含对应触发来源。
2. 常规拖拽调整窗口尺寸时不出现多次重复重算导致的性能问题。
3. 关闭视图或销毁窗口后，所有监听器与 interval 均被清理。
4. 代码通过 `npm run build`，并记录手动测试结果。

## 依赖与风险
- 依赖：T0011（表格配置块）、T0012（行操作恢复）保持稳定。
- 风险：轮询频率设置过高可能引入性能压力；需防止与 AG Grid 自身布局逻辑冲突。

---

**预计工作量**：1.5 ~ 2.5 小时  
**优先级**：高（影响多窗口体验的基础交互）
