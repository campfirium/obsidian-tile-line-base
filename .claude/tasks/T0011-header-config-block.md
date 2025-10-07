# T0011 - 头部配置块解析与宽度配置

## 目标
实现 ```tilelinebase 头部配置块解析，并实现列宽度配置功能。

## 任务拆解

### Phase 1: 基础解析
- [ ] 解析 ```tilelinebase 代码块
- [ ] 提取列定义（每行一个列）
- [ ] 解析列名和配置项
- [ ] 创建 ColumnConfig 数据结构

### Phase 2: Width 配置
- [ ] 解析 width 配置项（百分比、像素、auto）
- [ ] 更新 ColumnDef 生成逻辑，应用 width 配置
- [ ] 实现宽度自适应规则：
  - 有 width 的列：按指定值设置
  - 无 width 的列：flex: 1 自适应

### Phase 3: 测试
- [ ] 创建测试文件验证功能
- [ ] 测试百分比宽度
- [ ] 测试像素宽度
- [ ] 测试混合宽度（部分指定 + 部分自适应）

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
