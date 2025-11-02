# TileLineBase

一个基�?行即原子"架构�?Obsidian 段落数据库插件�?

## 当前状�?

**已完成：**

- �?**积木 1-2**：基础视图框架 + 读取真实文件
  - 视图切换功能（快捷键�?Markdown 和表格视图间切换�?
  - 文件右键菜单�?�?TileLineBase 表格打开"
  - 读取和显示文件内�?

- �?**积木 3-5**：H2 块解�?+ 表格渲染（模板H2模式�?
  - 解析文件中的所�?## H2 �?
  - 第一�?H2 块作为模板（Schema）定义列�?
  - 后续 H2 块作为数据行
  - 完整的表格渲染（表头 + 数据�?
  - 空值处理（`.` 或空段落显示为空单元格）

## 快速开�?

### 安装依赖

```bash
npm install
```

### 开发模�?

#### 方式1：Ctrl+Shift+B（推荐）

1. �?VSCode 中按 `Ctrl+Shift+B`
2. 选择"构建并部署到 Obsidian"
3. 插件会自动构建、复制到 Obsidian 插件目录、并重启 Obsidian

#### 方式2：命令行

```bash
# 构建并部署（包含重启�?
npm run deploy

# 仅构�?
npm run build

# 开发模式（监听文件变化�?
npm run dev
```

> 提示：执�?`npm run deploy` 前，请通过以下任一方式指定部署目录�? 

### 验证脚本

```bash
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-column-service.ts
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-lifecycle-manager.ts
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/dev/verify-interaction-controller.ts
```


### �?Obsidian 中使�?

1. **创建示例文件**：创建一�?.md 文件，粘贴以下内容：
   ```markdown
   ## 任务名称
   负责�?
   状�?

   ## 学习插件开�?
   张三
   进行�?

   ## 撰写文档
   王五
   已完�?
   ```

2. **切换到表格视�?*�?
   - 设置快捷键：设置 �?快捷�?�?搜索 "TileLineBase"
   - �?切换 TileLineBase 表格视图"绑定快捷�?
   - 按快捷键�?Markdown 和表格视图间切换

3. **或使用文件菜�?*�?
   - 右键文件 �?"�?TileLineBase 表格打开"

## 项目文档

- [项目设计书](./docs/项目设计书：TileLineBase%206.md)
- [积木式开发路线图](./docs/积木式开发路线图.md)
- [任务文件](../.claude/tasks/)

## 下一�?

**积木 6：可编辑单元�?*
- 让表格单元格可点击编�?
- 编辑后更新内存中的数�?
- 实时预览编辑效果

**积木 7：写回文�?*
- 将编辑后的数据写�?Markdown 文件
- 保持 H2 块结�?
- 防抖保存策略
