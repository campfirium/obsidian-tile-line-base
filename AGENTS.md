# AGENTS

## 项目总览
- TileLineBase 是基于 Obsidian 的数据表视图插件，核心流程：读取 Markdown → 解析 H2 段落 → 构建列 Schema → 调用 AG Grid 渲染 → 监听交互事件。
- 默认网格实现采用 `AgGridAdapter` 并遵循 `GridAdapter` 抽象，后续可替换为轻量或原生实现。
- 插件运行于 Obsidian 的 Node 环境，需兼顾桌面端性能、可访问性与安全约束。

## 目录结构与模块职责
- `.lab/`：私有工作区（已 gitignore），存放内部文档（`specs/`）、任务追踪（`tasks/`）与私有脚本。
- `docs/`：公共文档目录，供外部查阅。
- `src/main.ts`：管理插件注册、卸载与生命周期日志，禁止在此堆积业务逻辑。
- `src/TableView.ts`：负责聚合数据与视图控制，保持在 250 行以内（目标 ≤200 行），新增渲染或交互逻辑优先放入 `src/table-view/`。
- `src/table-view/`：拆分后的表格模块（如 `GridController`、`MarkdownBlockParser`、`SchemaBuilder`），新增逻辑按职责落位并补充注释说明复杂场景。
- `src/grid/`：封装 AG Grid 相关适配层（适配器、列宽策略、组件等），如需自定义渲染器或编辑器，先评估可复用性再落库。
- `src/i18n/index.ts` 与 `src/locales/*.json`：统一的国际化出口，所有 UI 字符串必须通过此模块管理。
- `src/utils/`、`src/services/`、`src/formula/`：通用工具、设置读取与公式引擎，避免彼此之间的循环依赖。
- `styles.css`：覆盖表格展示样式；新增主题时写明使用场景和依赖前提。
- `scripts/`：公共工具脚本（lint、release 检查、部署等）；联调或实验性脚本存放于 `.lab/scripts/`。
- `.lab/specs/`：需求、设计、实验记录，命名遵循“日期 + 空格 + 主题”，如 `251007 列表视图设计.md`。
- `.lab/tasks/`：任务追踪文档，仅追加新发现或子任务备注，不修改既有条目。
- `main.js`：构建产物，任何改动都应来源于 `src/` 的 TypeScript 编译。

## 开发流程
- **分支策略**：`dev` 用于日常开发及草稿提交，允许零碎 commit；`main` 仅用于发布，禁止直接合并，需通过 `git merge --squash dev` 输出干净版本记录。
- **工作区隔离 (Git Worktree)**：
    - 所有任务必须在独立工作区进行：`trees/feat-T{分支}-{任务名}`。
    - **操作铁律**：所有 Shell 命令（`apply_patch`、`edit`）必须在工作区目录下执行；严禁使用 `../../` 跳出目录修改根文件。
    - **环境准备**：新建工作区后，必须立即执行 `pwd` 确认路径，并修正 `.git` 指向及同步 `.vscode/tasks.json`。
- **提交流程**：
    - 提交前必做：`npm run build` 确保无报错。
    - 状态确认：`git status -sb` 确认仅包含本次任务文件。
    - 协作者：不要添加 AI 协作者信息。
- **语言文件管理**：
    - **英文 (en.json)**：允许为当前任务新增必要的 Key。
    - **其他语言**：绝对只读。除非任务明确要求“翻译/本地化”，否则禁止 AI 修改。

## 任务执行 SOP (标准作业程序)

当启动新任务时，遵循 **“隔离优先，交付导向”** 的原则：

1.  **环境建立**：
    - 根据任务 ID 和描述，自动生成简短英文目录名。
    - 创建并进入 `git worktree`，**强制核验当前路径 (`pwd`)**。
    - 确保所有后续代码修改操作都“锁”在这个目录下。

2.  **开发边界**：
    - 仅修改与任务直接相关的代码逻辑。
    - 默认仅修改英文 (en) 配置，不触碰其他语言文件。

3.  **交付汇报**：
    - 完成构建后，用中文汇报：
        - **功能摘要**：一句话概括业务逻辑变更（非代码细节）。
        - **验收步骤**：提供 PM 可操作的黑盒测试步骤（界面操作路径）。
        - **风险提示**：副作用或潜在冲突。

## 构建与验证
- `npm install`：更新依赖后执行。
- `npm run dev`：监听模式开发。
- `npm run build`：**提交前必须执行**，作为质量闸。
- `npm run deploy`：部署到测试 Vault。
- `npm run version`：更新版本号并打标签。
- **手工回归**：重点验证 TileLineBase 视图切换、H2 解析、交互逻辑（Enter 增行、Delete 清除）。
- **冲突排查**：遇到插件冲突时，优先使用 Log 脚本抓取调用栈，而非盲目猜测。

## 静态检查与提交流程
- Lint 依赖：使用 `eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`，通过 `.eslintrc.cjs` 管理规则并指向当前 `tsconfig.json`。
- **规则红线 (Zero Tolerance)**：
    - **严禁** 修改 `.eslintrc.cjs`、`tsconfig.json` 或使用 `// @ts-ignore`、`// eslint-disable` 来绕过报错。
    - 如果 Lint/Build 失败，必须**修复代码本身**，而不是降低检查标准。
- 命令规范：在 `package.json` 中定义 `lint` 脚本（`eslint "src/**/*.{ts,tsx}" --max-warnings=0`），与 `npm run build` 共同组成提交前的必须项。
- **阻断机制**：lint 或 build 失败必须立刻阻断提交。
- 依赖变更：调整 ESLint 或相关插件版本后，需要重新执行 `npm install` 并在 PR 中说明兼容性验证范围。

## 质量审查维度
- **Complexity**：新增功能应尊重现有模块边界；若核心文件趋于臃肿，先先撰写拆分计划再实施。
- **i18n**：所有 UI 字符串通过 `src/i18n` 注入，并同步维护 `src/locales/en.json`；新增字段在 PR 中注明翻译状态。禁止使用 `getText` 的第二参数或任何英文兜底，新增/调整 UI 文案前后必须先运行 `node scripts/check-i18n-hardcoded.mjs` 确认无硬编码，再执行 lint/build。
- **a11y**：确保 UI 可聚焦、可键盘操作，必要时提供 `aria-label` 或 `title`；新增网格组件需记录辅助功能验证步骤。
- **Security**：任何 Markdown 或外部输入必须经既有解析链路，禁止直接写入 `innerHTML`；引入第三方库时附带简要安全评估。
- **Testability**：核心解析、数据映射与网格交互逻辑保持可单独调用，避免与 Obsidian API 紧耦合；若无法避免，请在 `specs/` 记录手动验证步骤。
- **Performance**：高频事件（滚动、输入）需考虑防抖 (Debounce) 或节流 (Throttle)。
- **Log Hygiene**：生产环境代码禁止包含 console.trace；调试日志应使用统一前缀并可配置开关。

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
- `.lab/specs/` 用于记录需求、方案、实验与缺陷排查，使用MMYYDD开头命名，并在章节中注明结论。
- 与团队沟通统一使用中文，保留必要的英文术语以避免歧义；重要决策或边界情况请在 `.lab/specs/` 备案。
- 进行可访问性或性能排查时，记录复现 Markdown 样例、操作步骤及结果，方便后续回溯。
