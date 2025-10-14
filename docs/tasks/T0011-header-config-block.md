# T0011-header-config-block

## 目标
实现 ```tilelinebase 头部配置块解析，并实现列宽度配置功能。

## 任务拆解

### Phase 1: 基础解析 ✅
- [x] 解析 ```tlb 代码块
- [x] 提取列定义（每行一个列）
- [x] 解析列名和配置项
- [x] 创建 ColumnConfig 数据结构

### Phase 2: Width 配置 ✅
- [x] 解析 width 配置项（百分比、像素、auto、flex）
- [x] 更新 ColumnDef 生成逻辑，应用 width 配置
- [x] 实现智能宽度自适应规则：
  - 有 width 的列：按指定值设置
  - 无 width 的列：智能判断（短文本 autoSize，长文本 flex）

### Phase 3: 测试 ✅
- [x] 创建测试文件验证功能
- [x] 测试百分比宽度
- [x] 测试像素宽度
- [x] 测试混合宽度（部分指定 + 部分自适应）
- [x] 修复性能问题（内存泄露、重绘循环）

## 技术要点

### 配置块格式
```markdown
\`\`\`tilelinebase
任务 (width: 30%)
备注 (width: 30%)
价值
成本 (unit: 分钟)
优先级 (formula: = {价值}/({成本}+1, 2))
测试 (hide)
\`\`\`
```

251008 自动宽度看上去足够使用，宽度参数暂时搁置

### 列配置数据结构
```typescript
interface ColumnConfig {
  name: string;           // 列名
  width?: string;         // 宽度："30%", "150px", "auto"
  unit?: string;          // 单位："分钟"
  formula?: string;       // 公式："= {价值}/{成本}"
  hide?: boolean;         // 是否隐藏
}
```

### 宽度映射规则
- `width: 30%` → AG Grid: `width: 30%` (百分比)
- `width: 150px` → AG Grid: `width: 150` (数字)
- `width: auto` 或未定义 → AG Grid: `flex: 1` (自适应)
- 混合情况：指定宽度的列优先，剩余空间均分给 flex 列

## 依赖
- 依赖当前 KV 格式解析逻辑
- AG Grid columnDefs 配置

## 预期结果
- 头部配置块被正确解析
- 列宽度按配置正确显示
- 未配置宽度的列自适应

---

## 实现记录

### 2025-10-08: 修复表格重绘循环与智能列宽策略

**Commit:** `9d6fd0b` - fix: resolve table redraw loop and implement smart column width strategy

#### 问题发现

前一次提交 (`263ed13`) 实现了表格自适应窗口宽度和文本换行，但导致严重问题：

1. **内存泄露**：Obsidian 内存占用达到 8GB
2. **无限重绘循环**：表格打开后不停调整宽度和行高
3. **性能急剧下降**：页面卡顿，用户体验极差

**根本原因：**
```
窗口变化 → flex:1 使表格宽度变化
         → wrapText 改变换行点
         → autoHeight 重新计算所有行高
         → 表格总高度变化 → 触发父容器重新布局
         → 回到第1步 → 无限循环
```

#### 解决方案：智能列宽分配

**核心思想：列宽固定 → 换行点固定 → 行高稳定**

1. **短文本列**（≤30字符）：
   - 使用一次性 `autoSize` 计算紧凑宽度
   - 不随窗口变化重复调整
   - 设置 `maxWidth: 300px` 避免过宽

2. **长文本列**（>30字符）：
   - 使用 `flex: 1` 分配剩余空间
   - 设置 `minWidth: 200px` 避免过窄
   - 启用 `wrapText + autoHeight` 支持多行显示

3. **性能优化**：
   - 移除 `setTimeout` 循环中的重复 autoSize
   - CSS 移除 `flex: 1` 避免与 autoHeight 冲突
   - 保留列/行虚拟化提升性能

#### 技术实现

**AgGridAdapter.ts 核心改动：**

```typescript
// 智能判断长文本列
private isLongTextColumn(field: string, rows: RowData[]): boolean {
    const LONG_TEXT_THRESHOLD = 30; // 字符数阈值
    let maxLength = 0;
    for (const row of rows) {
        maxLength = Math.max(maxLength, String(row[field] || '').length);
    }
    return maxLength > LONG_TEXT_THRESHOLD;
}

// 列宽策略
if (!hasWidth && !hasFlex) {
    const isLongTextColumn = this.isLongTextColumn(col.field!, rows);

    if (isLongTextColumn) {
        // 长文本列：flex 分配剩余空间
        mergedColDef.flex = 1;
        mergedColDef.minWidth = 200;
    } else {
        // 短文本列：autoSize 一次性计算
        mergedColDef.maxWidth = 300;
    }
}

// 一次性 autoSize，不会重复执行
setTimeout(() => {
    this.autoSizeShortTextColumns(colDefs);
}, 100);
```

**TableView.ts 配置增强：**

支持更多配置关键字：
```typescript
width: auto   // 智能检测（默认）
width: flex   // 显式使用 flex
width: 200px  // 固定像素宽度
width: 30%    // 比例分配 (flex: 30)
```

**styles.css 修复：**

```css
.tlb-table-container {
    width: 100%;  /* 适应窗口宽度 */
    height: 100%; /* 占满父容器高度 */
    /* 移除 flex: 1，避免与 autoHeight 冲突 */
}
```

#### 效果对比

| 方案 | 短文本列 | 长文本列 | 性能 | 内存 |
|------|----------|----------|------|------|
| 旧方案 (全部 flex:1) | 浪费空间 ❌ | 均匀分配 ✅ | 循环重绘 ❌ | 8GB ❌ |
| 新方案 (智能判断) | 紧凑自适应 ✅ | 占据剩余空间 ✅ | 稳定 ✅ | 正常 ✅ |

#### 边界处理

✅ 短文本列总宽度过大 → AG Grid 自动启用水平滚动
✅ 窗口宽度变化 → 只有 flex 列响应，短文本列保持固定
✅ 避免循环重绘 → autoSize 只在初始化时执行一次
✅ 多语言支持 → 行高自适应，完整显示长文本内容

#### 文件变更

```
main.js                   | 87 +++++++++++++++++++++++++++++
src/TableView.ts          | 37 ++++++++++---
src/grid/AgGridAdapter.ts | 80 +++++++++++++++++++++++---
styles.css                |  9 ++--
4 files changed, 162 insertions(+), 51 deletions(-)
```

#### 最佳实践总结

**推荐配置方式：**
```markdown
\`\`\`tlb
标题 (width: 150px)   # 短文本：固定宽度
内容                  # 长文本：自动 flex
状态 (width: 80px)    # 短文本：固定宽度
备注 (width: flex)    # 显式指定 flex
\`\`\`
```

**核心原则：**
1. 列宽固定或有明确约束 → 不随内容变化
2. 行高自适应 → 支持长文本完整显示
3. 表格宽度适应窗口 → `width: 100%`
4. 避免循环触发 → 移除 autoSize 循环、避免 flex:1 冲突
