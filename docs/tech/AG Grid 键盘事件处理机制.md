# AG Grid 键盘事件处理机制

## 概述

在 AG Grid 中实现自定义键盘快捷键时，需要理解其内部的事件处理机制。本文档记录了在 TileLineBase 项目中发现的 AG Grid 键盘事件流程。

## 事件处理层级

AG Grid 的键盘事件处理有多个层级，按照事件触发的优先级排列：

### 1. CompositionProxy 层（最高优先级）

**位置**：`src/grid/AgGridAdapter.ts:288`

```typescript
proxy.setKeyHandler((event) => this.handleProxyKeyDown(event));
```

**特点**：
- CompositionProxy 是最先拦截键盘事件的层级
- 用于处理中文输入法等复合输入（Composition Events）
- 绑定在代理元素上，优先于 AG Grid 的事件处理

**处理流程**：
```typescript
private handleProxyKeyDown(event: KeyboardEvent): void {
    // 1. 检查是否为可打印字符
    if (this.isPrintable(event)) {
        return; // 交给输入法处理
    }

    // 2. 检查特殊快捷键（如 Ctrl+C）
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        this.handleCopyShortcut(event);
        return; // 🔑 事件在这里被拦截，不会传递到 onCellKeyDown
    }

    // 3. 处理其他导航键（Enter, Tab, 方向键等）
    switch (event.key) {
        case 'Enter':
        case 'Tab':
        case 'ArrowUp':
        // ...
    }
}
```

**关键发现**：
- 如果事件在 CompositionProxy 层被处理（调用 `preventDefault()` 或 `return`），它将**不会传递到 AG Grid 的 `onCellKeyDown` 事件**
- Ctrl+C、Ctrl+V 等快捷键在这一层就被拦截了

### 2. AG Grid onCellKeyDown（次优先级）

**位置**：`src/grid/AgGridAdapter.ts:780`

```typescript
gridOptions: {
    onCellKeyDown: (event: CellKeyDownEvent) => {
        const keyEvent = event.event;

        // 只有未被 CompositionProxy 拦截的事件才会到达这里
        if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key === 'c') {
            // ❌ 这段代码永远不会被触发，因为 Ctrl+C 已被 CompositionProxy 拦截
        }
    }
}
```

**特点**：
- AG Grid 官方提供的单元格键盘事件钩子
- 只接收未被上层拦截的事件
- 适合处理 AG Grid 默认不处理的键盘事件

### 3. suppressKeyboardEvent（最低优先级）

**位置**：`src/grid/AgGridAdapter.ts:878`

```typescript
defaultColDef: {
    suppressKeyboardEvent: (params: any) => {
        const keyEvent = params.event as KeyboardEvent;

        // 返回 true 表示阻止 AG Grid 的默认行为
        return this.handleEnterAtLastRow(/*...*/);
    }
}
```

**特点**：
- 用于选择性地阻止 AG Grid 的默认键盘行为
- 在 AG Grid 内部事件处理之后调用
- 返回 `true` 可以阻止 AG Grid 的默认行为（如 Enter 键导航）

## 实现自定义快捷键的正确方式

### 场景 1：拦截系统快捷键（如 Ctrl+C）

**问题**：需要在特定列（如序号列）上自定义 Ctrl+C 的行为

**错误做法**：
```typescript
// ❌ 这段代码不会被触发
onCellKeyDown: (event: CellKeyDownEvent) => {
    if ((event.event.ctrlKey) && event.event.key === 'c') {
        // 永远不会执行
    }
}
```

**正确做法**：在 `handleCopyShortcut` 中处理

```typescript
private handleCopyShortcut(event: KeyboardEvent): void {
    if (!this.gridApi) {
        return;
    }

    // 检查当前聚焦的单元格
    const focusedCell = this.gridApi.getFocusedCell();
    if (focusedCell) {
        const colId = focusedCell.column.getColId();

        // 特定列的自定义行为
        if (colId === '#') {
            // 自定义复制逻辑
            this.gridContext?.onCopyH2Section(rowIndex);
            return;
        }
    }

    // 默认行为
    const text = this.extractFocusedCellText();
    this.copyTextToClipboard(doc, text);
}
```

### 场景 2：添加新的快捷键（如 Ctrl+D）

**做法**：在 `handleProxyKeyDown` 中添加

```typescript
private handleProxyKeyDown(event: KeyboardEvent): void {
    // ...

    // 自定义快捷键
    if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        event.preventDefault();
        event.stopPropagation();
        this.handleDuplicateShortcut(event);
        return;
    }

    // ...
}
```

### 场景 3：自定义 AG Grid 默认行为（如 Enter 键）

**做法**：使用 `suppressKeyboardEvent`

```typescript
suppressKeyboardEvent: (params: any) => {
    const keyEvent = params.event as KeyboardEvent;

    if (keyEvent.key === 'Enter') {
        // 自定义逻辑
        const handled = this.handleEnterAtLastRow(/*...*/);

        // 返回 true 阻止 AG Grid 的默认 Enter 行为
        return handled;
    }

    return false; // 其他键保留 AG Grid 默认行为
}
```

## 事件流程图

```
键盘按下
    ↓
┌─────────────────────────────┐
│  CompositionProxy           │
│  handleProxyKeyDown()       │
│  - Ctrl+C/V/X               │
│  - Enter, Tab, 方向键        │
└─────────────────────────────┘
    ↓ (如果未被拦截)
┌─────────────────────────────┐
│  AG Grid onCellKeyDown      │
│  - 未被拦截的按键事件         │
└─────────────────────────────┘
    ↓
┌─────────────────────────────┐
│  AG Grid 内部处理            │
│  - 默认编辑、导航等行为       │
└─────────────────────────────┘
    ↓
┌─────────────────────────────┐
│  suppressKeyboardEvent      │
│  - 可选择性阻止默认行为       │
└─────────────────────────────┘
```

## 最佳实践

1. **明确事件处理层级**：
   - 系统快捷键（Ctrl+C/V/X）：在 `handleProxyKeyDown` 或相应的 handler 中处理
   - 自定义快捷键：在 `handleProxyKeyDown` 中添加
   - 修改 AG Grid 默认行为：使用 `suppressKeyboardEvent`
   - 处理未拦截事件：使用 `onCellKeyDown`

2. **保存 context 以便回调**：
   ```typescript
   private gridContext?: {
       onCopyH2Section?: (rowIndex: number) => void;
       // 其他回调...
   };

   mount(container, columns, rows, context) {
       this.gridContext = context;
   }
   ```

3. **添加调试日志**：
   ```typescript
   console.log('[AgGrid] handleCopyShortcut - 列ID:', colId);
   ```

4. **事件处理后的清理**：
   ```typescript
   event.preventDefault();
   event.stopPropagation();
   ```

## 相关代码位置

- CompositionProxy 设置：`src/grid/AgGridAdapter.ts:288`
- handleProxyKeyDown：`src/grid/AgGridAdapter.ts:307`
- handleCopyShortcut：`src/grid/AgGridAdapter.ts:374`
- onCellKeyDown：`src/grid/AgGridAdapter.ts:780`
- suppressKeyboardEvent：`src/grid/AgGridAdapter.ts:878`

## 参考资料

- [AG Grid 键盘导航文档](https://www.ag-grid.com/javascript-data-grid/keyboard-navigation/)
- [AG Grid 自定义编辑器](https://www.ag-grid.com/javascript-data-grid/cell-editors/)
- CompositionProxy 实现：`src/grid/utils/CompositionProxy.ts`
