# TileLineBase

一个基于"行即原子"架构的 Obsidian 段落数据库插件。

## 当前状态

**积木 1：Hello Table - 基础视图框架** ✅

- 显示硬编码的假数据表格（2行2列）
- 注册命令和侧边栏图标
- 基础样式

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

### 在 Obsidian 中使用

1. 在命令面板（Ctrl+P）中输入"打开 TileLineBase 表格"
2. 或点击左侧功能区的表格图标
3. 表格视图会在右侧边栏打开

## 项目文档

- [项目设计书](./docs/项目设计书：TileLineBase%206.md)
- [积木式开发路线图](./docs/积木式开发路线图.md)
- [任务文件](../.claude/tasks/)

## 下一步

- 积木 2：读取真实文件
- 积木 3：解析 H2 块
