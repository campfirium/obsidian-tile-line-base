# Obsidian 多窗口环境下的技术差异

**日期**: 2025-10-22
**问题类型**: Obsidian Pop-out 窗口与主窗口的行为差异

---

## 背景

Obsidian 支持 Pop-out 窗口（弹出窗口），允许用户将视图拖到独立窗口中。但是，Pop-out 窗口与主窗口有着本质的技术差异，这些差异会导致某些功能在主窗口正常工作，但在 Pop-out 窗口中失效。

---

## 核心技术差异

### 1. 独立的 DOM 环境

每个 Pop-out 窗口都有自己独立的：
- **`Window` 对象**：不同于主窗口的 `window`
- **`Document` 对象**：不同于主窗口的 `document`
- **全局构造函数**：`HTMLElement`、`Event` 等都是该窗口独有的实例

**影响**：
- 使用全局 `document` 创建的元素无法在 Pop-out 窗口中正常工作
- 事件对象的原型链不同，`instanceof` 检查可能失败
- 跨窗口传递对象时需要特别注意

**解决方法**：
- 使用 `element.ownerDocument` 获取元素所属的 document
- 使用 `element.ownerDocument.defaultView` 获取元素所属的 window
- 使用 `element.instanceOf(Constructor)` 而非 `instanceof`

### 2. 共享的 App 和 Workspace

虽然每个窗口有独立的 DOM，但 Obsidian 的核心对象是共享的：
- **`app` 对象**：所有窗口共享同一个 `app` 实例
- **`workspace` 对象**：所有窗口共享同一个 `workspace` 实例
- **插件实例**：插件只有一个实例，服务所有窗口

**影响**：
- `workspace.getLeaf()` 无法指定目标窗口，可能返回主窗口的 leaf
- 事件监听器在主窗口注册，但需要处理所有窗口的事件
- 状态管理需要区分不同窗口

**解决方法**：
- 使用 `workspace.activeLeaf` 获取当前活跃的 leaf
- 通过 `leaf.view.containerEl.ownerDocument.defaultView` 判断 leaf 所属窗口
- 使用 `workspace.on('window-open')` 监听新窗口打开

---

## 案例：AG Grid 的 eventKey 参数丢失

### 问题描述

在 TileLineBase 插件中，我们使用自定义的 `TextCellEditor` 来捕获按键启动编辑时的首字符，避免首字符丢失。

**主窗口**：工作正常，`eventKey` 参数有值
```javascript
eventKey: '1'  // ✅ 正常
```

**Pop-out 窗口**：`eventKey` 参数为 null
```javascript
eventKey: null  // ❌ 失败
```

### 根本原因

AG Grid 在捕获键盘事件并传递给自定义编辑器时，使用了某种内部状态存储机制。这个机制在跨窗口时失效，导致 `eventKey` 参数无法传递到 Pop-out 窗口的编辑器中。

**关键发现**：
- AG Grid 的键盘事件监听本身是正常的（其他键盘功能都工作）
- 只有 `eventKey` 参数的传递在 Pop-out 窗口中失败
- 这表明问题出在 AG Grid 内部的参数传递机制

### 解决方案

**思路**：手动捕获按键，并通过 `cellEditorParams` 传递给编辑器

#### 1. 在 AgGridAdapter 中添加状态变量

```typescript
export class AgGridAdapter implements GridAdapter {
	// 用于在 pop-out 窗口中捕获启动编辑的按键
	private lastKeyPressedForEdit: string | null = null;
```

#### 2. 在 suppressKeyboardEvent 中捕获按键

```typescript
suppressKeyboardEvent: (params: any) => {
	const keyEvent = params.event as KeyboardEvent;

	// 捕获可打印字符，用于 pop-out 窗口的首字符修复
	if (!params.editing && keyEvent.type === 'keydown') {
		const isPrintableChar = keyEvent.key.length === 1 &&
			!keyEvent.ctrlKey && !keyEvent.altKey && !keyEvent.metaKey;

		if (isPrintableChar) {
			this.lastKeyPressedForEdit = keyEvent.key;
		}
	}
	// ... 其他逻辑
}
```

#### 3. 通过 cellEditorParams 传递按键

```typescript
cellEditorParams: (params: any) => {
	const capturedKey = this.lastKeyPressedForEdit;
	this.lastKeyPressedForEdit = null; // 清除状态

	return {
		...params,
		manualEventKey: capturedKey  // 传递手动捕获的按键
	};
}
```

#### 4. 在 TextCellEditor 中使用

```typescript
init(params: ICellEditorParams): void {
	const eventKey = (params as any).eventKey;
	const manualEventKey = (params as any).manualEventKey;
	// 优先使用 AG Grid 的 eventKey，如果没有则使用手动捕获的
	const actualKey = eventKey || manualEventKey;

	if (actualKey && actualKey.length === 1) {
		this.eInput.value = actualKey;
	} else {
		this.eInput.value = this.initialValue;
	}
}
```

### 效果

- ✅ 主窗口：继续使用 AG Grid 的 `eventKey`（原生机制）
- ✅ Pop-out 窗口：使用手动捕获的 `manualEventKey`（自定义机制）
- ✅ 两个窗口都能正常捕获首字符

---

## 历史类似问题

### 问题 1: TableView 在 Pop-out 窗口中无法渲染（已解决）

**症状**：在 Pop-out 窗口中打开表格视图时，完全没有日志输出，视图未渲染

**原因**：视图打开逻辑总是使用主窗口的 `workspace.getLeaf(false)`，导致视图在主窗口打开而非 Pop-out 窗口

**解决方案**：
1. 从事件上下文中获取触发窗口
2. 在该窗口的 workspace 中查找或创建 leaf
3. 使用 `requestAnimationFrame` 延迟 AG Grid 初始化，确保 DOM 已挂载

### 问题 2: DOM 元素创建在错误的 document 上（已解决）

**症状**：自定义渲染器、编辑器中创建的元素无法正常工作

**原因**：使用全局 `document.createElement()` 创建元素，而非 Pop-out 窗口的 document

**解决方案**：
```typescript
// ❌ 错误
this.eInput = document.createElement('input');

// ✅ 正确
const doc = params.eGridCell?.ownerDocument || document;
this.eInput = doc.createElement('input');
```

---

## 通用调试策略

### 1. 添加窗口标识日志

```typescript
const isMain = container.ownerDocument === document;
console.log('当前窗口:', isMain ? '主窗口' : 'Pop-out 窗口');
console.log('ownerDocument.location.href:', container.ownerDocument.location.href);
```

### 2. 对比主窗口和 Pop-out 窗口的日志

在相同操作下，分别在主窗口和 Pop-out 窗口中执行，对比日志差异

### 3. 检查对象来源

```typescript
console.log('element.ownerDocument === document:', element.ownerDocument === document);
console.log('event.view === window:', event.view === window);
```

### 4. 验证 API 可用性

某些浏览器 API 在 Pop-out 窗口中可能有不同的行为，需要逐一测试

---

## 最佳实践

### DO ✅

1. **总是使用 `ownerDocument` 和 `ownerDocument.defaultView`**
   ```typescript
   const doc = element.ownerDocument;
   const win = doc.defaultView;
   ```

2. **从事件对象获取窗口上下文**
   ```typescript
   const targetWindow = event.view; // MouseEvent, KeyboardEvent 都有
   ```

3. **延迟 DOM 操作到正确的时机**
   ```typescript
   const win = container.ownerDocument.defaultView;
   win.requestAnimationFrame(() => {
       // 在这里初始化依赖 DOM 的组件
   });
   ```

4. **为每个窗口独立初始化**
   ```typescript
   workspace.on('window-open', (workspaceWindow, win) => {
       // 为新窗口注册事件监听器、初始化状态等
   });
   ```

### DON'T ❌

1. **不要假设全局对象是正确的**
   ```typescript
   // ❌ 错误
   document.body.appendChild(element);

   // ✅ 正确
   element.ownerDocument.body.appendChild(element);
   ```

2. **不要使用 `instanceof` 检查跨窗口对象**
   ```typescript
   // ❌ 错误
   if (obj instanceof HTMLElement) { }

   // ✅ 正确
   if (obj.instanceOf && obj.instanceOf(HTMLElement)) { }
   // 或者
   if (obj.ownerDocument) { } // 鸭子类型
   ```

3. **不要在一个窗口创建元素然后移到另一个窗口**
   ```typescript
   // ❌ 可能有问题
   const div = document.createElement('div');
   popoutWindow.document.body.appendChild(div);

   // ✅ 正确
   const div = popoutWindow.document.createElement('div');
   popoutWindow.document.body.appendChild(div);
   ```

---

## 参考资料

- [Obsidian 官方：如何更新插件以支持 Pop-out 窗口](https://obsidian.md/blog/how-to-update-plugins-to-support-pop-out-windows/)
- [Obsidian Help: Pop-out windows](https://help.obsidian.md/pop-out-windows)
- [相关问题分析文档](./251017%20ag-grid%20输入丢失首字符.md)

---

## 总结

Obsidian Pop-out 窗口的本质是一个独立的浏览器窗口，具有完全独立的 DOM 环境。在开发插件时，必须时刻记住：

1. **不要假设只有一个窗口**
2. **总是使用元素自己的 document 和 window**
3. **从事件和上下文中获取正确的窗口引用**
4. **对比测试主窗口和 Pop-out 窗口的行为**

当遇到"主窗口正常，Pop-out 窗口异常"的问题时，优先检查：
- 是否使用了全局 `document` 或 `window`
- 是否有跨窗口的对象传递
- 第三方库（如 AG Grid）是否有内部状态管理问题
