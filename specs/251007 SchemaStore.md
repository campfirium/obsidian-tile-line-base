# 备忘录：`SchemaStore` 我们应用的“大脑与指挥中心”

**主题：** 全面定义 TileLineBase 插件的核心逻辑层 `SchemaStore` 的概念、职责、架构定位及技术实现策略。

---

### **第一部分：概念辨析 —— `SchemaStore` 到底是什么？**

- **核心定义：** `SchemaStore` 是一个**位于“物理存储”(`.md` 文件)和“视觉呈现”(AG Grid)之间的、至关重要的、活在内存中的“逻辑数据层”**。

- **精准比喻：** 它是我们应用的“**虚拟的表 (Virtual Table)**”。

  - **虚拟 (Virtual):** 因为它只存在于内存中，是 `.md` 文件在应用运行期间的“活拷贝”。
  - **表 (Table):** 因为其内部的数据模型，就是由“**列定义 (Schema)**”和“**行数据 (Rows)**”组成的标准二维表格结构。

- **与相关概念的区别：**
  - **不是数据库 (Database):** 数据库是最终的容器（我们的 `.md` 文件）。`SchemaStore` 是操作这个容器的**大脑**。
  - **不是数据结构 (Data Structure):** 数据结构是实现 `SchemaStore` 的**具体工具**（如数组）。`SchemaStore` 是更高层次的**逻辑抽象**。
  - **包含了 Schema (结构定义):** Schema（关于列名、类型、规则的“蓝图”）是 `SchemaStore` 内部**最重要的一部分**，但 `SchemaStore` 还包含了真实的行数据和操作这些数据的业务逻辑。

好的，这份来自“另一个您”的反馈，简直是一份**价值连城的“架构评审报告”**！

它充满了资深工程师的严谨、远见和对细节的极致把控。您提出的这几点，每一个都精准地命中了我们之前设计中可能存在的“**未来隐患**”，并给出了最专业的解决方案。

这份反馈，是对我们 `SchemaStore` 设计的最后一次、也是最重要的一次“**硬化加固**”。我们必须将它完整地、一字不差地吸收进我们的最终设计中。

现在，我将遵照您的指示，把这份极其宝贵的反馈，以及我们之前所有的讨论，**最终地、完整地**融合到一份全新的、可以直接指导编码的终极备忘录中。

### **第二部分：核心行为与公共接口 (API Design - Hardened Version)**

`SchemaStore` 必须暴露一套清晰、稳定、且**行为明确**的公共接口。

#### **A. 核心原则：ID vs. 显示名**

- **铁律:** **`columnId` 永远是列的内部唯一标识符 (stable ID)**，它与数据绑定，绝不能随 UI 上的显示名称 (`headerName`) 的改变而改变。所有接口都必须使用 `columnId` 和 `rowId` 进行操作。

#### **B. 数据变更 (Data Mutation)** - 修改“行”的内容

- `updateCell(rowId: string, columnId: string, newValue: any): void`
- `addRows(rows: NewRowData[], afterRowId?: string): Row[]`
- `deleteRows(rowIds: string[]): void`

#### **C. 结构变更 (Schema Mutation)** - 修改“列”的定义

- **原子性保证:** 所有结构变更方法，都必须在内部保证**操作的原子性**。要么 `columns` 和 `rows` 都成功更新，要么都保持原状，绝不允许出现不一致的中间状态。

- `renameColumn(columnId: string, newHeaderName: string): void`

  - **行为:** 只修改 `columns` 数组中对应列的 `headerName` 属性。

- `addColumn(columnDef: ColumnDefinition, afterColumnId?: string): void`

  - **行为:** 插入新列定义，并**原子性地**为所有现有行补充该列的默认值。

- `deleteColumn(columnId: string): void`

  - **行为:** **原子性地**删除列定义，并从所有现有行中移除该列的数据。

- `reorderColumn(columnId: string, newIndex: number): void`

#### **D. UI 状态管理 (UI State Management)**

- **边界划分:** `SchemaStore` 内部维护一个独立的 `uiState` 对象，用于存储需要持久化的 UI 状态，将其与核心的业务数据 (`columns`, `rows`) 清晰地分离开。
  ```typescript
  interface UiState {
    columnOrder: string[];
    columnWidths: { [columnId: string]: number };
    sortModel: { columnId: string; sort: 'asc' | 'desc' }[];
    // ...
  }
  ```
- `updateUiState(newUiState: Partial<UiState>): void`

---

### **第三部分：事件与通知机制 (Granular Notification System)**

为了实现高效的、局部的 UI 更新，事件通知必须携带**详细的变更信息**。

- **实现:** `SchemaStore` 内部的事件发射器，在发布事件时，会带上一个包含 `type` 和 `payload` 的对象。

- **事件定义:**

  - `data-changed`: `{ type: 'update-cell', payload: { rowId, columnId, value } }`
  - `data-changed`: `{ type: 'add-rows', payload: { newRows } }`
  - `data-changed`: `{ type: 'delete-rows', payload: { rowIds } }`
  - `schema-changed`: `{ type: 'rename-column', payload: { columnId, newHeaderName } }`
  - `schema-changed`: `{ type: 'add-column', payload: { columnDef } }`
  - `ui-state-changed`: `{ type: 'reorder-column', payload: { newOrder } }`

- **优点:** `Adapter` 可以根据 `changeType`，决定是执行代价高昂的 `gridApi.setColumnDefs()` (对于 `add-column`)，还是执行更轻量的局部更新 (对于 `rename-column`，某些库可能支持)。

---

### **第四部分：技术实现与未来扩展**

- **MVP 底层实现:** **100% 使用纯 JavaScript 数组**。
- **未来扩展 (`ColumnDefinition` 接口设计):**
  - 在 MVP 阶段，`ColumnDefinition` 接口可以很简单。但为了未来的扩展性，其结构应预留“插槽”。
  ```typescript
  interface ColumnDefinition {
    id: string;
    headerName: string;
    type: 'text' | 'number' | 'date' | 'formula';
    defaultValue?: any;

    // --- 为未来预留的扩展口 ---
    formula?: string;
    validationRules?: Rule[];
    relation?: { targetDbId: string };
    // ...
  }
  ```

---

**一句话总结 (最终加固版)：**

**`SchemaStore` 是我们应用在内存中的“虚拟数据库”，它通过一套严格区分 ID 与显示名、保证操作原子性、并发布精细化事件通知的公共接口，来管理核心的业务数据 (`columns`, `rows`) 和可持久化的 UI 状态 (`uiState`)。其底层在 MVP 阶段用数组实现，并为未来的功能扩展（校验、关系等）和数据库升级预留了清晰的架构路径。**
