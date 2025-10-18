# 251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2

**问题描述**：在 AG Grid 中使用按键启动编辑时，中文输入法（IME）会丢失首字符。

**测试环境**：
- 输入法：双拼（微软拼音）
- 浏览器：基于 Chromium 的 Obsidian
- 测试用例：输入 "ni"（双拼）期望得到 "你"

---

## 问题根源分析

### 核心矛盾

**按键启动编辑** 与 **IME 组合机制** 存在天然冲突：

1. **按键启动编辑**：检测到首个可打印字符后立即启动编辑器
2. **IME 组合**：需要多个按键序列才能完成一个字符的输入
3. **冲突**：首个按键被捕获用于启动编辑器，导致 IME 只接收到后续按键

### 具体表现

用户输入 "ni" 想得到 "你"：
- 首字符 "n" 被捕获用于启动编辑
- IME 只收到 "i"
- "i" 在双拼中对应 "ch" → 输出 "吃"

---

## 尝试 1：方案 1 - IME 检测分流（失败）

### 实现思路

参考文档 `251018 AG-Grid单元格编辑与输入法冲突问题分析.md` 中的方案 1：

通过检测 `keyCode === 229` 或 `key === 'Process'` 来识别 IME 输入，分为两条路径：
- **ASCII 路径**：直接传递首字符给编辑器
- **IME 路径**：不传递首字符，让输入法自己处理

### 实现代码

```typescript
onCellKeyDown: (params: any) => {
    const keyEvent = params.event as KeyboardEvent;
    const isPrintableChar = keyEvent.key.length === 1 &&
        !keyEvent.ctrlKey && !keyEvent.altKey && !keyEvent.metaKey;

    if (!isPrintableChar) return;

    // 检测 IME
    const looksLikeIme = keyEvent.isComposing ||
        keyEvent.key === 'Process' ||
        (keyEvent as any).keyCode === 229;

    if (looksLikeIme) {
        // IME 路径：不传字符
        api.startEditingCell({ rowIndex, colKey });
    } else {
        // ASCII 路径：传递首字符
        this.lastKeyPressedForEdit = keyEvent.key;
        api.startEditingCell({ rowIndex, colKey });
    }
}
```

### 测试结果

**失败**。实际测试日志：

```
[AgGridAdapter] onCellKeyDown 详细信息:
  key: n
  keyCode: 78
  which: 78
  isComposing: false
  type: keydown
  looksLikeIme: false
```

**失败原因**：
- 在用户的输入法配置下，第一个键 "n" 并没有给出 `keyCode === 229` 或 `key === 'Process'`
- `keyCode: 78` 是字母 "n" 的标准 ASCII 码
- 系统误判为 ASCII 输入，捕获了 "n"

**结论**：某些输入法在第一个键时不会触发 IME 标记，导致检测失败。

---

## 尝试 2：方案 2 - 隐藏缓冲输入框（失败）

### 实现思路

参考文档 `251018 AG-Grid单元格编辑与输入法冲突问题分析.md` 中的方案 2：

创建一个隐藏的离屏 `<input>` 元素作为缓冲器：
1. 检测到可打印字符后，将焦点切换到隐藏输入框
2. 等待 IME 组合完成（`compositionend`）或超时（ASCII）
3. 将捕获的文本传递给 AG Grid 编辑器

### 实现代码

**ImeBuffer.ts**：
```typescript
export class ImeBuffer {
    private input: HTMLInputElement;

    constructor(ownerDocument: Document = document) {
        this.input = ownerDocument.createElement('input');
        Object.assign(this.input.style, {
            position: 'fixed',
            left: '-9999px',
            top: '0',
            opacity: '0'
        });
        ownerDocument.body.appendChild(this.input);
    }

    captureFirstText(): Promise<string> {
        return new Promise<string>((resolve) => {
            this.input.value = '';
            this.input.focus();

            let composing = false;

            const onCompEnd = (e: CompositionEvent) => {
                composing = false;
                cleanup();
                resolve(e.data || this.input.value);
            };

            const onInput = () => {
                if (!composing) {
                    setTimeout(() => {
                        if (!composing) {
                            cleanup();
                            resolve(this.input.value);
                        }
                    }, 10);
                }
            };

            // 监听事件...
        });
    }
}
```

**AgGridAdapter.ts**：
```typescript
onCellKeyDown: (params: any) => {
    const keyEvent = params.event as KeyboardEvent;
    const isPrintableChar = keyEvent.key.length === 1 &&
        !keyEvent.ctrlKey && !keyEvent.altKey && !keyEvent.metaKey;

    if (!isPrintableChar) return;

    const bufferPromise = this.imeBuffer!.captureFirstText();

    bufferPromise.then((text) => {
        this.lastKeyPressedForEdit = text;
        api.startEditingCell({ rowIndex, colKey });

        // 将捕获的文本设置到编辑器
        queueMicrotask(() => {
            const editorInput = ownerDoc.querySelector('.ag-cell-editor input');
            if (editorInput && text) {
                editorInput.value = text;
                editorInput.focus();
            }
        });
    });
}
```

### 测试结果 - 第一轮

**首字符丢失**。测试日志：

```
[AgGridAdapter] 可打印字符按下，启动 ImeBuffer 捕获
[ImeBuffer] ASCII 超时触发，文本:
[ImeBuffer] 清理事件监听器
[AgGridAdapter] ImeBuffer 返回文本:
```

**失败原因**：
- `keydown` 事件触发时，按键还没有被输入到任何元素
- 虽然调用了 `focus()`，但焦点切换不是同步的
- 第一个 "n" 键的事件已经过去，没有进入隐藏输入框

### 优化：手动注入首字符

在 `suppressKeyboardEvent` 中手动将首字符添加到缓冲输入框：

```typescript
suppressKeyboardEvent: (params: any) => {
    const keyEvent = params.event as KeyboardEvent;
    const isPrintableChar = keyEvent.key.length === 1 &&
        !keyEvent.ctrlKey && !keyEvent.altKey && !keyEvent.metaKey;

    if (isPrintableChar) {
        if (this.imeBuffer) {
            const bufferInput = (this.imeBuffer as any).input;
            bufferInput.value = '';
            bufferInput.focus();

            // 手动添加首字符
            if (!keyEvent.isComposing) {
                queueMicrotask(() => {
                    bufferInput.value = keyEvent.key;
                });
            }
        }
        return true; // 阻止 AG Grid 默认处理
    }
}
```

### 测试结果 - 第二轮

**仍然失败**。测试日志：

```
[suppressKeyboardEvent] 焦点已切换到 ImeBuffer，手动添加首字符: n
[ImeBuffer] compositionstart - 开始 IME 组合
[ImeBuffer] input 事件触发
  composing: true
  input.value: ch
[ImeBuffer] input 事件触发
  composing: true
  input.value: 吃
[ImeBuffer] compositionend - IME 组合结束
  event.data: 吃
  input.value: 吃
[AgGridAdapter] ImeBuffer 返回文本: 吃
```

**失败原因**：
- 首字符 "n" 虽然被手动添加到了缓冲输入框（`value = 'n'`）
- 但第二个按键 "i" 进入输入框时，输入框中的 "n" 被 IME 忽略或覆盖
- IME 只看到了 "i" → "ch" → "吃"

### 根本问题

**隐藏缓冲输入框的方案存在严重的用户体验问题**：

1. **用户看不到候选列表**：IME 的候选窗口显示在隐藏输入框的位置（屏幕外）
2. **无法正常选字**：用户看不到候选，无法用数字键或空格选择
3. **超时机制不可靠**：
   - 设置太短（60-200ms）→ 用户还在输入拼音就被打断
   - 设置太长（5秒）→ 用户体验差，等待时间长
4. **焦点切换不可控**：浏览器的焦点切换和事件传递是异步的，难以保证首字符进入缓冲框

**结论**：隐藏缓冲输入框的方案理论上可行，但实践中问题太多，不适合这个场景。

---

## 尝试 3：简化方案 - 放弃捕获首字符（当前方案）

### 设计思路

**核心理念**：不要和浏览器的 IME 机制对抗，简化处理逻辑。

**实现策略**：
1. 检测到可打印字符 → 直接启动编辑器（不捕获首字符）
2. 编辑器打开后是空的
3. 用户在真实的、可见的编辑器输入框中重新输入（包括首字符）
4. IME 在真实输入框中正常工作

### 实现代码

**AgGridAdapter.ts**：
```typescript
onCellKeyDown: (params: any) => {
    const keyEvent = params.event as KeyboardEvent;
    if (params.editing) return;

    const isPrintableChar = keyEvent.key.length === 1 &&
        !keyEvent.ctrlKey && !keyEvent.altKey && !keyEvent.metaKey;

    if (!isPrintableChar) return;

    console.log('[AgGridAdapter] 可打印字符按下，直接启动编辑器');

    const api = params.api;
    const colKey = params.column.getColId();
    const rowIndex = params.rowIndex;

    // 阻止默认行为
    keyEvent.preventDefault();

    // 直接启动编辑器（不传递首字符）
    api.startEditingCell({ rowIndex, colKey });
}
```

**TextCellEditor.ts**（简化版）：
```typescript
export function createTextCellEditor() {
    return class implements ICellEditorComp {
        private eInput!: HTMLInputElement;
        private initialValue: string = '';

        init(params: ICellEditorParams): void {
            const doc = (params.eGridCell?.ownerDocument || document);

            this.eInput = doc.createElement('input');
            this.eInput.type = 'text';
            this.eInput.classList.add('ag-cell-edit-input');
            this.eInput.style.width = '100%';
            this.eInput.style.height = '100%';

            this.initialValue = params.value ?? '';

            // 始终使用原值（按键启动时为空，双击启动时为原有内容）
            this.eInput.value = this.initialValue;

            // 添加键盘事件处理
            this.eInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === 'Tab') {
                    event.stopPropagation();
                    params.stopEditing(false);
                } else if (event.key === 'Escape') {
                    event.stopPropagation();
                    params.stopEditing(true);
                }
            });
        }

        afterGuiAttached(): void {
            this.eInput.focus();
            if (this.initialValue) {
                this.eInput.select(); // 双击启动：全选原值
            }
            // 按键启动：光标在开头（空输入框）
        }

        getValue(): string {
            return this.eInput.value;
        }

        // ... 其他方法
    };
}
```

### 用户体验

**操作流程**：
1. 用户按下 "n" → 编辑器立即打开（输入框为空）
2. 用户看到编辑器打开，知道要继续输入
3. 用户重新输入完整的 "ni" → IME 正常工作 → 得到 "你"

**优点**：
- ✅ IME 完全正常工作（在真实、可见的输入框中）
- ✅ 代码极其简单，易于维护
- ✅ 支持 pop-out 窗口（使用 `ownerDocument`）
- ✅ 没有复杂的焦点切换、事件捕获、超时判断
- ✅ 用户可以看到 IME 候选列表，正常选字

**缺点**：
- ❌ 用户需要重新输入首字符（按 "n" 后，需要重新输入 "ni"）
- ❌ 与 Excel 等软件的行为不一致（Excel 会保留首字符）

### 测试结果

**待测试**。

**正确的测试步骤**：
1. 在空单元格上按下 "n"
2. 编辑器应该打开，输入框为**空**
3. **重新输入完整的 "ni"**（不要只输入 "i"）
4. 应该得到 "你"

---

## 总结与建议

### 三种方案对比

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 方案 1：IME 检测分流 | 理论上可以区分 ASCII 和 IME | 某些输入法不触发 IME 标记，检测不可靠 | ❌ 失败 |
| 方案 2：隐藏缓冲输入框 | 理论上可以捕获完整输入 | 用户看不到候选列表，焦点切换不可控，首字符丢失 | ❌ 失败 |
| 方案 3：放弃捕获首字符 | 简单可靠，IME 完全正常 | 用户需要重新输入首字符 | ✅ 推荐 |

### 推荐方案

**方案 3：放弃捕获首字符**

**理由**：
1. **技术可靠性**：不依赖浏览器的 IME 检测，不需要复杂的事件捕获
2. **用户体验可接受**：用户看到编辑器打开，自然会继续输入
3. **代码可维护性**：极其简单，不到 100 行代码
4. **跨平台兼容性**：支持所有 IME（中文、日文、韩文等）

**替代方案（如果必须保留首字符）**：
- 提供配置选项：用户可以选择"双击启动编辑"模式，禁用按键启动
- 文档说明：告知用户这是 IME 兼容性的技术限制

### 未来优化方向

1. **配置化**：提供 `editMode` 配置项
   ```typescript
   editMode: 'key-press' | 'double-click' | 'F2'
   ```

2. **视觉反馈**：编辑器打开时显示提示，告诉用户可以开始输入

3. **快捷键支持**：F2 启动编辑并保留原值（类似 Excel）

---

## 参考文档

- `251018 AG-Grid单元格编辑与输入法冲突问题分析.md`：专家分析文档，提供了方案 1 和方案 2
- `251018 Obsidian多窗口环境下的技术差异.md`：pop-out 窗口技术文档
