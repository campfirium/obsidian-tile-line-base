# TileLineBase

一个基于"行即原子"架构的 Obsidian 段落数据库插件。

## 当前状态

**已完成：**

- ✅ **积木 1-2**：基础视图框架 + 读取真实文件
  - 视图切换功能（快捷键在 Markdown 和表格视图间切换）
  - 文件右键菜单："以 TileLineBase 表格打开"
  - 读取和显示文件内容

- ✅ **积木 3-5**：H2 块解析 + 表格渲染（模板H2模式）
  - 解析文件中的所有 ## H2 块
  - 第一个 H2 块作为模板（Schema）定义列名
  - 后续 H2 块作为数据行
  - 完整的表格渲染（表头 + 数据）
  - 空值处理（`.` 或空段落显示为空单元格）

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

#### 方式1：Ctrl+Shift+B（推荐）

1. 在 VSCode 中按 `Ctrl+Shift+B`
2. 选择"构建并部署到 Obsidian"
3. 插件会自动构建、复制到 Obsidian 插件目录、并重启 Obsidian

#### 方式2：命令行

```bash
# 构建并部署（包含重启）
npm run deploy

# 仅构建
npm run build

# 开发模式（监听文件变化）
npm run dev
```

### 验证脚本

```bash
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-column-service.ts
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-lifecycle-manager.ts
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-interaction-controller.ts
```


### 在 Obsidian 中使用

1. **创建示例文件**：创建一个 .md 文件，粘贴以下内容：
   ```markdown
   ## 任务名称
   负责人
   状态

   ## 学习插件开发
   张三
   进行中

   ## 撰写文档
   王五
   已完成
   ```

2. **切换到表格视图**：
   - 设置快捷键：设置 → 快捷键 → 搜索 "TileLineBase"
   - 为"切换 TileLineBase 表格视图"绑定快捷键
   - 按快捷键在 Markdown 和表格视图间切换

3. **或使用文件菜单**：
   - 右键文件 → "以 TileLineBase 表格打开"

## 项目文档

- [项目设计书](./docs/项目设计书：TileLineBase%206.md)
- [积木式开发路线图](./docs/积木式开发路线图.md)
- [任务文件](../.claude/tasks/)

## 下一步

**积木 6：可编辑单元格**
- 让表格单元格可点击编辑
- 编辑后更新内存中的数据
- 实时预览编辑效果

**积木 7：写回文件**
- 将编辑后的数据写回 Markdown 文件
- 保持 H2 块结构
- 防抖保存策略
