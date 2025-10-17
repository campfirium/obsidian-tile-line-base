# T0020-column-status-property

## 需求概述

实现 status 列属性，支持 GTD 风格的任务状态管理。

参考规格说明：`docs/specs/251011 列属性 status.md`

## 功能要求

### 1. 状态类型（5种）
- `todo`（待办）：☐ 空方框
- `done`（已完成）：☑ 方框中对勾
- `inprogress`（进行中）：⊟ 方框中横线
- `onhold`（已搁置）：⏸ 暂停符号
- `canceled`（已放弃）：☒ 方框中叉号

### 2. 交互方式
- **左键点击**：在 `todo` ↔ `done` 之间切换（最常用操作）
- **右键菜单**：显示完整的 5 种状态选项

### 3. 视觉反馈
- `done` 和 `canceled` 状态的行：
  - 整行半透明（opacity: 0.5）
  - 标题列添加删除线（text-decoration: line-through）

### 4. 自动时间戳
- 每次状态变更时，自动更新 `statusChanged` 字段
- `statusChanged` 作为压缩属性保存到文件（不显示为列）

### 5. 内置列
- status 列应作为内置系统列自动添加
- 默认位置：第二列（在第一个数据列后面）
- 新行默认值：`todo`

## 实现计划

### 阶段 1：创建 StatusCellRenderer
- [ ] 创建 `src/renderers/StatusCellRenderer.ts`
- [ ] 实现 5 种状态的图标渲染
- [ ] 支持状态值规范化（容错处理）

### 阶段 2：集成到 AgGridAdapter
- [ ] 配置 status 列使用自定义渲染器
- [ ] 实现左键点击切换（onCellClicked）
- [ ] 实现右键菜单（getContextMenuItems）
- [ ] 添加行样式规则（rowClassRules）

### 阶段 3：集成到 TableView
- [ ] 自动添加 status 为内置列
- [ ] 新行初始化 status='todo'
- [ ] 状态变更时自动更新 statusChanged
- [ ] blocksToMarkdown 输出 statusChanged 字段

### 阶段 4：CSS 样式
- [ ] 添加 .tlb-row-completed 样式
- [ ] 完成状态行：半透明 + 删除线

## 技术要点

- 使用 AG Grid 的 ICellRendererComp 接口
- 使用 Unicode 字符渲染图标（无需图片资源）
- statusChanged 作为压缩属性（不在 columnNames 中）
- 状态值规范化处理（支持多种别名）

## 测试要点

1. 状态列自动显示在第二列位置
2. 左键点击能够在 todo/done 之间切换
3. 右键菜单显示所有 5 种状态选项
4. 状态变更后 statusChanged 自动更新
5. done/canceled 行显示半透明和删除线
6. 新增行默认 status='todo'
7. 文件保存后 statusChanged 字段正确写入

## 参考资料

- 规格说明：`docs/specs/251011 列属性 status.md`
- AG Grid Cell Renderer: https://www.ag-grid.com/javascript-data-grid/component-cell-renderer/
- AG Grid Context Menu: https://www.ag-grid.com/javascript-data-grid/context-menu/
