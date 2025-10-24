# AGENTS

## 项目总览
- TileLineBase 是基于 Obsidian 的数据表视图插件，核心流程：读取 Markdown → 解析 H2 段落 → 构建列 Schema → 调用 AG Grid 渲染 → 监听交互事件。
- 默认网格实现采用 `AgGridAdapter` 并遵循 `GridAdapter` 抽象，后续可替换为轻量或原生实现。
- 插件运行于 Obsidian 的 Node 环境，需兼顾桌面端性能、可访问性与安全约束。

## 目录结构与模块职责
- `src/main.ts`：管理插件注册、卸载与生命周期日志，禁止在此堆积业务逻辑。
- `src/TableView.ts`：负责聚合数据与视图控制，保持在 250 行以内（目标 ≤200 行），新增渲染或交互逻辑优先放入 `src/table-view/`。
- `src/table-view/`：拆分后的表格模块（如 `GridController`、`MarkdownBlockParser`、`SchemaBuilder`），新增逻辑按职责落位并补充注释说明复杂场景。
- `src/grid/`：封装 AG Grid 相关适配层（适配器、列宽策略、组件等），如需自定义渲染器或编辑器，先评估可复用性再落库。
- `src/i18n/index.ts` 与 `src/locales/*.json`：统一的国际化出口，所有 UI 字符串必须通过此模块管理。
- `src/utils/`、`src/services/`、`src/formula/`：通用工具、设置读取与公式引擎，避免彼此之间的循环依赖。
- `styles.css`：覆盖表格展示样式；新增主题时写明使用场景和依赖前提。
- `scripts/`：部署与联调脚本，使用相对路径或环境变量，避免硬编码本地 Vault。
- `specs/`：需求、设计、实验记录，命名遵循“日期 + 空格 + 主题”，如 `251007 列表视图设计.md`。
- `docs/tasks/`：任务追踪文档，仅追加新发现或子任务备注，不修改既有条目。
- `main.js`：构建产物，任何改动都应来源于 `src/` 的 TypeScript 编译。

## 开发流程
- 分支策略：`main`（生产）、`dev`（集成）、`feat/T000X-topic`（功能）、`fix/T000X-topic`（缺陷）。禁止直接在 `main` 提交或对公共分支执行 rebase，合并回 `dev` 时使用 `--no-ff`。
- 任务驱动：1) 在 `docs/tasks/T000X_英文描述` 建立任务记录；2) 从 `dev` 切出对应分支开发；3) 完成阶段性工作后合并回 `dev` 并保留 feature 分支；4) 定期由 `dev` 合并进入 `main`。
- 提交流程：每次提交前必须通过 `npm run build`，确保 `git status -sb` 仅含本次任务改动；不要添加 AI 协作者信息。
- PR 规范：提供摘要、构建和操作系统信息、关联任务编号；若涉及 UI，附截图或 GIF，并标注主要入口和受影响文件。

## 构建与验证
- `npm install`：安装依赖，更新 `package.json` 后必须重新执行。
- `npm run dev`：监听模式运行 `esbuild.config.mjs`，适合迭代开发，保持终端开启以获取增量构建。
- `npm run build`：先执行 `tsc` 再输出最新 `main.js`，作为发布前的必备质量闸。
- `npm run deploy`：在构建后将插件同步到绑定的 Obsidian Vault，并触发 Obsidian 重载以便手动验证。
- `npm run version`：同步更新 `manifest.json` 与 `versions.json` 的版本信息，执行后需在提交中包含相关变更并推送标签。
- 构建问题排查：先尝试 `npm cache clean --force` 与删除 `node_modules` 后重装；必要时检查 `npm ls ag-grid-community` 以确认依赖版本。
- 手工回归：验证 TileLineBase 视图的切换、H2 块解析、列配置加载、窗口尺寸响应；重点检查基础交互（最后一行 `Enter` 自动增行、`Delete/Backspace` 清除单元格、单选/多选逻辑）。
- 调试建议：使用 Obsidian 开发者工具（Ctrl+Shift+I）查看 console 与 DOM 结构，必要时记录截图或日志以支持问题复现。

## 静态检查与提交流程
- Lint 依赖：使用 `eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`，通过 `.eslintrc.cjs` 管理规则并指向当前 `tsconfig.json`。
- 命令规范：在 `package.json` 中定义 `lint` 脚本（`eslint "src/**/*.{ts,tsx}" --max-warnings=0`），与 `npm run build` 共同组成提交前的必须项。
- 提交流水线：推荐 `husky + lint-staged`，备选 `simple-git-hooks`；无论采用何种方案，lint 或 build 失败必须立刻阻断提交。
- 依赖变更：调整 ESLint 或相关插件版本后，需要重新执行 `npm install` 并在 PR 中说明兼容性验证范围。

## 质量审查维度
- **Complexity**：新增功能应尊重现有模块边界；若核心文件趋于臃肿，先在 `docs/specs/` 撰写拆分计划，再实施迁移，持续维持 `src/TableView.ts` 的行数目标。
- **i18n**：所有 UI 字符串通过 `src/i18n/index.ts` 注入，并同步维护 `src/locales/en.json` 与 `src/locales/zh.json`；新增字段在 PR 中注明翻译状态。
- **a11y**：确保 UI 可聚焦、可键盘操作，必要时提供 `aria-label` 或 `title`；新增网格组件需记录辅助功能验证步骤。
- **Security**：任何 Markdown 或外部输入必须经既有解析链路，禁止直接写入 `innerHTML`；引入第三方库时附带简要安全评估。
- **Testability**：核心解析、数据映射与网格交互逻辑保持可单独调用，避免与 Obsidian API 紧耦合；若无法避免，请在 `specs/` 记录手动验证步骤。
- **Performance**：以 10k 行数据为压力基准评估新逻辑；说明时间复杂度和潜在内存成本，必要时提供基准数据或采用延迟加载/批处理策略。

## 代码规范
- 语言与格式：统一使用 TypeScript，采用制表符缩进；引号风格与周边保持一致，导入语句按功能分组。
- 命名约定：类使用 `PascalCase`，变量与函数使用 `camelCase`，导出常量使用 `SCREAMING_SNAKE_CASE`。
- 注释要求：代码注释、TODO、JSDoc 必须使用英文；若 UI 展示中文字符串，请在同段注释说明含义。
- 模块拆分：复杂的解析或网格配置逻辑优先放入 `src/table-view/` 或 `src/grid/` 子模块；避免在 `TableView`、`main.ts` 或 `AgGridAdapter` 中堆积多职责代码。
- 日志规范：禁止直接修改 `main.js`；在生命周期钩子中输出日志时请增加统一前缀，便于在 Obsidian console 中筛选。
- Markdown 解析：调整正则时确保覆盖多语言标题，并在代码附近写明意图与边界条件。
- 资源同步：变更列配置或国际化字段时，保持 TypeScript 定义、JSON 文案与说明文档同步更新。

## 安全与配置提示
- 新增依赖需评估许可证与运行时体积，必要时在 PR 中写明安全考量。
- 若需要外部服务或额外权限，需同步更新 `manifest.json`、README 以及用户配置说明。
- 部署脚本避免硬编码本地路径，始终使用仓库根目录或环境变量。
- 发布前确认仓库未包含私人 Vault 数据、临时令牌或测试文件。

## 文档与沟通
- `docs/specs/` 用于记录需求、方案、实验与缺陷排查，保持时间顺序命名，并在章节中注明结论。
- 与团队沟通统一使用中文，保留必要的英文术语以避免歧义；重要决策或边界情况请在 `docs/specs/` 备案。
- 进行可访问性或性能排查时，记录复现 Markdown 样例、操作步骤及结果，方便后续回溯。
