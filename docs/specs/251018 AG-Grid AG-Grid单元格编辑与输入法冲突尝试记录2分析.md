# 251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2分析

**作者**：Z × 助手  
**环境**：Obsidian（Chromium 内核）、AG Grid、微软拼音（双拼），含主窗口 + Pop-out  
**状态**：✅ 可落地方案 + ✅ 回归测试清单 + ✅ 代码骨架  
**一句话定位**：**别和浏览器的 IME 状态机硬碰硬**。让“首键的默认输入”落到**已聚焦、就位**的编辑宿主，再把结果写回 AG Grid。

---

## 0. 背景与症状

- 需求：在单元格上**按任意可打印键**即可进入编辑，并**不丢失首字符**；中文 IME（拼音/双拼）要从**首键**开始组合。
    
- 现象：AG Grid 默认路径（`charPress`/`eventKey`）会**吃掉首键**用来“启动编辑”，导致 IME 只看到后续键，最终**拼音被截断**（双拼 `n i → 你` 变成只认 `i`，上屏 “吃”）。
    

---

## 1. 根因与失败路径复盘

### 1.1 天然矛盾

- **AG Grid 的“按键启动编辑”**：在首个 `keydown` 上创建编辑器并传 `eventKey/charPress`。
    
- **IME 合成**：需要**连续的物理按键序列**在**同一已聚焦元素**里完成 `compositionstart → compositionend`。
    
- **冲突**：首键被框架消费，不进入 IME 的序列，合成链断裂。
    

### 1.2 已验证的失败路线

- **229/Process 探测（分流 ASCII / IME）**：部分输入法首键就是标准 ASCII（如 `key="n"`、`keyCode=78`），**识别不到 IME** → 误判。
    
- **隐藏离屏 `<input>` 缓冲**：  
    候选窗锚点飞屏外，焦点切换与事件触发存在竞态，**首键依旧错过**，用户也**看不见候选**。
    
- **事后补首键/恢复初值/手动插入**：程序化修改 `value` **不会被 IME 当作组合序列**，无效。
    
- **只看 `isComposing`**：浏览器规范决定**多数 IME 首键 `isComposing=false`**，第二键才变真 → 为时已晚。
    

> 结论：**识别-补救**路线上限不高。要改走**架构法**——让**首键默认输入**从一开始就落在**已聚焦**的编辑宿主。

---

## 2. 业界对照与正确姿势

- **Excel（原生）**：在 OS 消息循环早期把焦点切给单元格编辑控件/公式栏，首键直接进入编辑宿主。
    
- **Google Sheets（Web）**：在单元格上方创建**可编辑 overlay**（`contenteditable`），**先聚焦**，让首键进入 overlay，IME 合成在 overlay 完成，再把结果回写数据模型。
    

> 本文提出的方案即复刻这一路线：**Composition Proxy Overlay（合成代理层）**。

---

## 3. 终极方案 · Composition Proxy Overlay

**目标**：保证**第一个按键**就进入一个**可见位置（就位）、已聚焦**的**编辑宿主**，IME 候选窗锚点正确；合成完成后再把最终文本写回 AG Grid 的真正编辑器。

### 3.1 行为概览（时序）

```
keydown(首键) ──> 我们拦截：禁止 AG Grid 吃键（suppressKeyboardEvent=true）
                 │
                 └─> 同步聚焦到覆盖单元格的 contenteditable overlay（不 preventDefault）
                        │
                        ├─ ASCII：input 32ms 快速路径 → 得到单字符
                        └─ IME：compositionstart → … → compositionend → 得到最终文本
                                   │
startEditingCell() ──> 将文本写入 TextCellEditor 的 <input> → 光标置尾 → 焦点回交
```

### 3.2 代理层要点（稳定性的关键）

- **位置**：绝对/固定定位到**当前单元格矩形**；**宽高**至少 `8×16px`，并设置 `line-height = cellHeight`，避免候选漂移。
    
- **可见性**：推荐“视觉透明”而非纯 `opacity:0`：  
    `color: transparent; caret-color: transparent; background: transparent; opacity:1;`  
    或保留 `opacity:0` 但注意部分环境的候选定位问题。
    
- **焦点**：在 `keydown` 同一轮事件内**先 focus 到 overlay**，不调用 `preventDefault`，让首键默认输入落入 overlay。
    
- **生命周期**：**一次性捕获**。拿到文本即清理、失焦、定位清空。
    
- **合成期间键盘接管**：全键拦截，避免方向键、Enter、Tab 被 AG Grid 抢走。
    

---

## 4. 代码骨架（可直接嵌入）

> 以下 TypeScript 片段覆盖 **代理层类** + **AG Grid 接管逻辑** + **编辑器侧最小改动**。按你的项目分文件即可。

### 4.1 `CompositionProxy.ts`（单例/每个 `Document` 一份）

```ts
export class CompositionProxy {
  private host: HTMLDivElement;
  private ownerDocument: Document;
  private resolve?: (text: string) => void;
  private reject?: (err?: any) => void;
  private composing = false;
  private asciiTimer: number | null = null;

  constructor(ownerDocument: Document = document) {
    this.ownerDocument = ownerDocument;
    const el = ownerDocument.createElement('div');
    el.setAttribute('contenteditable', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      zIndex: '2147483647',
      // 视觉透明（比纯 opacity:0 更稳）
      color: 'transparent',
      caretColor: 'transparent',
      background: 'transparent',
      outline: 'none',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      // 不要设置 display:none/visibility:hidden
    } as CSSStyleDeclaration);
    this.host = el;
    ownerDocument.body.appendChild(el);

    // 合成事件
    this.host.addEventListener('compositionstart', () => { this.composing = true; });
    this.host.addEventListener('compositionend', (e: CompositionEvent) => {
      this.composing = false;
      const text = (e.data ?? this.host.textContent ?? '').toString();
      this.cleanup();
      this.resolve?.(text);
    });

    // ASCII 快速路径：未进入合成，极短延迟拿文本
    this.host.addEventListener('input', () => {
      if (!this.composing && this.asciiTimer == null) {
        this.asciiTimer = window.setTimeout(() => {
          const text = (this.host.textContent ?? '').toString();
          this.cleanup();
          this.resolve?.(text);
        }, 32);
      }
    });

    // 保险：Esc 取消
    this.host.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.cleanup();
        this.reject?.('cancelled');
      }
    });
  }

  private cleanup() {
    if (this.asciiTimer != null) {
      window.clearTimeout(this.asciiTimer);
      this.asciiTimer = null;
    }
    this.host.textContent = '';
    // 让出焦点（避免后续键继续落到代理层）
    (this.ownerDocument.activeElement as HTMLElement | null)?.blur?.();
  }

  /** 在指定矩形处激活代理层并捕获一次文本（ASCII 或 IME 最终产物） */
  captureOnceAt(rect: DOMRect): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      const w = Math.max(8, rect.width);
      const h = Math.max(16, rect.height);
      Object.assign(this.host.style, {
        left: `${Math.max(0, rect.left)}px`,
        top: `${Math.max(0, rect.top)}px`,
        width: `${w}px`,
        height: `${h}px`,
        lineHeight: `${h}px`,
      });

      this.host.textContent = '';
      this.host.focus();
    });
  }
}
```

### 4.2 `AgGridAdapter.ts`（接管首键、调用代理层、写回编辑器）

```ts
import type { GridOptions, GridApi } from 'ag-grid-community';
import { CompositionProxy } from './CompositionProxy';

export class AgGridAdapter {
  private proxyByDoc = new WeakMap<Document, CompositionProxy>();
  private capturing = false;

  private getProxy(doc: Document) {
    let p = this.proxyByDoc.get(doc);
    if (!p) {
      p = new CompositionProxy(doc);
      this.proxyByDoc.set(doc, p);
    }
    return p;
  }

  private isPrintable(e: KeyboardEvent) {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  }

  init(gridOptions: GridOptions) {
    gridOptions.suppressKeyboardEvent = (p) => {
      const e = p.event as KeyboardEvent;
      if (this.capturing) return true; // 合成期一刀切：任何键别给 AG Grid
      // 首键：可打印字符由我们接管，其他键走 AG Grid
      return this.isPrintable(e);
    };

    gridOptions.onCellKeyDown = async (p) => {
      const e = p.event as KeyboardEvent;
      if (this.capturing || p.editing || !this.isPrintable(e)) return;

      this.capturing = true;
      const targetEl = e.target as HTMLElement;
      const doc = targetEl.ownerDocument || document;

      try {
        const cellEl = targetEl.closest('.ag-cell') as HTMLElement;
        if (!cellEl) return;

        // 计算单元格可视矩形（滚动期间可加滚动跟随，见 §5）
        const rect = cellEl.getBoundingClientRect();

        // 不要 preventDefault —— 让“首键默认输入”落入 overlay
        const text = await this.getProxy(doc).captureOnceAt(rect);

        // 启动真正的编辑器
        const api = p.api as GridApi;
        api.startEditingCell({ rowIndex: p.rowIndex, colKey: p.column.getColId() });

        // 将文本写回编辑器输入框
        queueMicrotask(() => {
          const editorRoot = doc.querySelector('.ag-cell-editor');
          const input = editorRoot?.querySelector('input,textarea') as HTMLInputElement|HTMLTextAreaElement|null;
          if (!input) return;

          // 写回策略：replace / append，可配置
          const replace = true;
          if (replace) {
            input.value = text ?? '';
          } else {
            input.value = (input.value ?? '') + (text ?? '');
          }
          const n = input.value.length;
          input.setSelectionRange(n, n);
          input.focus();
        });
      } finally {
        this.capturing = false;
      }
    };
  }
}
```

### 4.3 `TextCellEditor`（最小化改动）

```ts
init(params: ICellEditorParams) {
  const doc = (params.eGridCell?.ownerDocument || document);
  this.eInput = doc.createElement('input');
  this.eInput.type = 'text';
  this.eInput.classList.add('ag-cell-edit-input');
  this.eInput.style.width = '100%';
  this.eInput.style.height = '100%';

  // 只用原值，首键文本由 Overlay 写回；不要再用 params.eventKey/charPress
  this.eInput.value = String(params.value ?? '');

  this.eInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.stopPropagation(); params.stopEditing(false); }
    else if (ev.key === 'Escape') { ev.stopPropagation(); params.stopEditing(true); }
  });
}

afterGuiAttached() {
  this.eInput.focus();
  // 若双击进入编辑，保留原值可选择全选
  // this.eInput.select();
}
```

---

## 5. 细节打磨与边界处理

1. **候选锚点稳定**
    

- 代理层高度/行高与单元格匹配：`height = cellRect.height; line-height = height`。
    
- 最小宽高：`width ≥ 8px、height ≥ 16px`，避免 IME 不弹窗。
    

2. **可见性策略**
    

- 推荐视觉透明（`color: transparent; caret-color: transparent; background: transparent; opacity:1`），避免个别环境下 `opacity:0` 导致候选锚点偏移。
    

3. **合成期键盘接管**
    

- 设置 `capturing = true`；在 `suppressKeyboardEvent` 直接 `return true`，屏蔽 AG Grid 的热键与导航键（方向键、Enter、Tab 会参与候选选择）。
    

4. **滚动/虚拟化**
    

- 合成期若发生容器滚动，候选锚点会漂移。  
    可在容器 `scroll` 事件中 `requestAnimationFrame` 里**刷新代理层位置**（再调用一次 `getBoundingClientRect()` 设置 `left/top`），直到捕获完成。
    

5. **Pop-out 多文档**
    

- 使用 `WeakMap<Document, CompositionProxy>`；每个文档一份代理层，避免跨窗口引用。
    

6. **写回策略**
    

- 默认 **覆盖**：`input.value = text`（与 Excel 单元格覆盖编辑一致）。
    
- 可配置 **追加**（如搜索框式列）：`input.value = old + text`。
    

7. **取消/异常**
    

- 用户合成中按 `Esc`：代理层 `reject('cancelled')`，本轮不进入编辑。
    
- 超长合成无需超时；**以 `compositionend` 为准**，否则会截断输入。
    

---

## 6. 测试矩阵（必须全部通过）

### 基础用例

- 英文 `a`：上屏 `a`，不丢首键。
    
- 数字 `1`：上屏 `1`。
    
- 全拼 `ni → 你`：候选窗锚在单元格之上，合成完成上屏 `你`。
    
- 双拼（微软拼音）`n` `i` → `你`：不再只认 `i`，不上 “吃”。
    

### 复杂/边角

- **Pop-out 窗口**：与主窗一致。
    
- **极慢输入**：长期停留候选，结束时正确上屏。
    
- **快速连击**：“北京”“中华人民共和国”首字不丢。
    
- **滚动过程中输入**：候选窗跟随单元格位置。
    
- **Esc**：取消输入，不进入编辑。
    
- **双击/F2 路径**：仍可用，不受影响。
    

---

## 7. 配置与产品策略

- `editMode`（产品可选项）：
    
    - `key-press`（默认）：启用 **Overlay**，首键即入、IME 友好。
        
    - `double-click`：禁用首键启动，仅双击/F2（最保守）。
        
- `writeBackMode`：`replace | append`（按列/场景配置）。
    
- 文档说明：对“AG Grid 默认 charPress 路径与 IME 冲突”的技术背景留痕，便于后续维护与团队协作。
    

---

## 8. 与既有方案对比（最终定论）

|路线|思想|首键是否保留|IME 兼容|候选可见|复杂度|结论|
|---|---|--:|:-:|:-:|:-:|---|
|`charPress/eventKey`|事后回填|❌|差|候选错位|低|放弃|
|229/Process 探测|识别→分流|不稳定|一般|一般|中|不可靠|
|隐藏离屏 `<input>`|缓冲输入|偶尔|差|❌|中|不推荐|
|**Composition Proxy Overlay**|**首键导流到已聚焦宿主**|**✅**|**好**|**✅**|**中**|**采用**|
|放弃首键|简化/重打|—|好|✅|低|兜底可选|

---

## 9. 小贴士（踩坑黑名单）

- ❌ 在编辑器 `init()` 里根据 `params.eventKey/charPress` 写入首字符（IME 会被截断）。
    
- ❌ 依赖 `isComposing` 识别首键（首键常为 `false`）。
    
- ❌ `opacity:0` + 极小尺寸（候选不弹或漂移）。
    
- ❌ `preventDefault()` 掐掉首键默认输入（首键就没地方可去）。
    
- ❌ 合成中未屏蔽 AG Grid 导航键（候选被方向键/Enter 打断）。
    

---

## 10. 未来可选优化

- `beforeinput.inputType` 统计/遥测：了解“ASCII vs IME”占比，动态优化策略。
    
- **滚动跟随**封装到 `CompositionProxy` 内部，暴露 `start/stop` API。
    
- 多语言 IME（假名/韩文）回归；移动端软键盘验证（iOS/Android）。
    

---

## 11. 附：最小改动清单（Diff 风格要点）

- **AgGridAdapter**
    
    - 新增：`capturing` 标志、`suppressKeyboardEvent` 全拦合成期按键
        
    - 新增：`onCellKeyDown` → 定位单元格 → `proxy.captureOnceAt(rect)` → `startEditingCell()` → 写回
        
    - 维护：每个 `Document` 一个 `CompositionProxy`（WeakMap）
        
- **TextCellEditor**
    
    - 删除：任何基于 `eventKey/charPress` 的首键写入逻辑
        
    - 保留：原值填充、Enter/Tab/Esc 行为
        
- **样式**
    
    - 无需全局 CSS，仅代理层内联样式即可
        

---

## 12. 收尾

这一版把“原理-策略-实现-测试”打通了：**用 Overlay 把首键导流回“正确的宿主”**，IME 自然就听话了。  
如果后续你要合并到项目文档体系，我可以再给你拆分出「设计说明」「实现手册」「回归清单」三页版本，便于团队协作与代码评审。