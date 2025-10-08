# Repository Guidelines

## 项目结构与模块组织
- `src/` 存放 TypeScript 源码：`main.ts` 管理 Obsidian 插件生命周期，`TableView.ts` 负责解析与视图逻辑，`src/grid/` 封装 AG Grid 适配器。
- `main.js` 为构建产物，修改 `src/` 后让构建流程自动生成，避免直接编辑编译文件。
- `styles.css` 可覆盖表格展示样式；需要定制主题时在此新增选择器并备注使用场景。
- `scripts/` 放置部署辅助脚本；`specs/` 保存需求、设计与实验记录，新增结论请补充在此。
- 调整插件元数据或权限时，同时更新 `manifest.json` 与 `package.json`，保持两者同步，并检查 `version` 字段。
- `specs/` 下的文档遵循“日期 + 空格 + 主题”命名，如 `251007 列表视图设计.md`，便于时间线回溯。

## 构建、测试与开发命令
- `npm install` 安装依赖，更新 `package.json` 后请重新执行。
- `npm run dev` 以监听模式运行 `esbuild.config.mjs`，适合迭代开发；终端保持开启即可增量构建。
- `npm run build` 先通过 `tsc` 做类型检查，再编译出最新的 `main.js`，发布前务必通过该命令。
- `npm run deploy` 在构建后将插件复制到绑定的 Obsidian Vault，便于手动验证，也会触发 Obsidian 重载。
- `npm run version` 更新版本信息并暂存 `manifest.json`、`versions.json`，提交时包含这些改动，并重新推送标签。
- 需要检查依赖树时可运行 `npm ls ag-grid-community`，确认 AG Grid 版本符合预期。
- 如遇构建失败可先执行 `npm cache clean --force` 与 `rm -rf node_modules`，随后重新 `npm install`。

## 代码风格与命名约定
- 使用 TypeScript + 制表符缩进；引号风格保持与周边一致，导入语句按逻辑分组。
- 类名采用 `PascalCase`，变量/函数使用 `camelCase`，导出常量保持 `SCREAMING_SNAKE_CASE`。
- 复杂的解析或网格配置逻辑应拆入 `src/grid/` 子模块，并在难懂的片段前添加简明注释，保持中文与英文术语一致。
- 禁止直接修改 `main.js`，必要日志请在插件生命周期钩子中添加带前缀的输出，便于过滤。
- 在编辑 Markdown 解析器时，确保正则表达式覆盖多语言标题，必要时补充单元注释说明。

## 测试指南
- 当前无自动化测试，`npm run build` 是基础质量闸。
- 在隔离的 Obsidian Vault 中验证功能：切换 TileLineBase 视图、检查 H2 块解析、确认列配置生效，并留意窗口尺寸变化的行为。
- 若修复渲染缺陷，请记录复现 Markdown 样例，并附带操作步骤。
- 将探索结果、缺陷或边界情况记录到 `specs/`，为后续积木迭代提供背景。
- 调试时可使用 Obsidian 开发者工具（Ctrl+Shift+I）查看 console 输出与 DOM 结构，必要时抓取截图或日志。

## 提交与拉取请求规范
- 沿用 Conventional Commits（如 `feat:`, `fix:`, `docs:`）的历史风格。
- 每次提交聚焦单一主题，包含相关文档或配置变更，避免遗漏。
- 提交 PR 时附上摘要、测试说明（构建 + 操作系统）、关联问题编号，以及涉及 UI 时的截图或 GIF。
- 在 PR 描述中列出主要代码入口和受影响文件，帮助评审快速定位。
- 建议分支命名遵循 `feature/<module>-<topic>` 或 `fix/<issue-id>` 格式，方便持续集成过滤。

## 架构概览
- TileLineBase 以 Markdown H2 标题为段落主键，`TableView` 将其解析为结构化行数据，再交由网格层渲染。
- `GridAdapter` 定义网格抽象接口，目前默认使用 `AgGridAdapter`，未来可以拓展轻量或原生实现。
- 渲染流程依次为：读取文件 → 检索头部配置块 → 构建列 Schema → 映射数据行 → 初始化 AG Grid → 监听交互事件。

## 安全与配置提示
- Obsidian 插件运行在 Node 环境，谨慎引入新依赖，必要时说明安全评估结果。
- 若需要访问外部服务，请在 `manifest.json` 中注明权限，并在 README 中标注配置步骤。
- 在部署脚本中避免硬编码路径，改用环境变量或仓库根目录相对路径。
- 提交到公共仓库前，请确认未包含 Vault 私人笔记、测试数据或临时令牌。

Hard Requirement: call binaries directly in functions.shell, always set workdir, and avoid shell wrappers such as `bash -lc`, `sh -lc`, `zsh -lc`, `cmd /c`, `pwsh.exe -NoLogo -NoProfile -Command`, and `powershell.exe -NoLogo -NoProfile -Command`.

- Text Editing Priority: Use the `apply_patch` tool for all routine text edits; fall back to `sed` for single-line substitutions only if `apply_patch` is unavailable, and avoid `python` editing scripts unless both options fail.
- `apply_patch` Usage: Invoke `apply_patch` with the patch payload as the second element in the command array (no shell-style flags). Provide `workdir` and, when helpful, a short `justification` alongside the command.

- Example invocation:

```bash
{"command":["apply_patch","*** Begin Patch\n*** Update File: path/to/file\n@@\n- old\n+ new\n*** End Patch\n"],"workdir":"<workdir>","justification":"Brief reason for the change"}