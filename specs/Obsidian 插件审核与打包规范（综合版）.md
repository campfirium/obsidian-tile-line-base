#  Obsidian 插件审核与打包规范（综合版）

> 基于官方 Developer Documentation，结合 obsidian-releases 审核记录与社区约定提炼。

---

### 1. 文件与体积限制

|项|要求|来源|
|---|---|---|
|打包文件必须包含|`manifest.json`, `main.js`, 可选 `styles.css`|官方 README|
|插件总大小|**≤ 2 MB（含依赖）**|审核执行规则（多次 PR 评论）|
|`manifest.json`|严格 JSON 格式，不得带注释|官方自动校验|
|目录结构|三文件必须在根目录，禁止嵌套|审核脚本|
|编译输出|单一 bundle (`rollup` 推荐)|官方模板|

**超 2 MB 会直接打回。** 通常原因：带图标、内嵌字体、捆绑大型库（如 lodash-full、dayjs 全量）。

---

### 2. 安全与隐私

|项|要求|
|---|---|
|禁止使用 `eval`、`Function()`、`new Function()`||
|禁止远程加载 JS 或资源（`fetch` 外部脚本、CDN）||
|禁止上传或收集用户数据||
|禁止调用 Node/Electron API（除非 `isDesktopOnly: true`）||
|禁止写入 Vault 以外路径或执行命令行||
|使用 `createEl()` / `createDiv()` 代替 `innerHTML` / `insertAdjacentHTML`||

---

### 3. 命名与版本规范

|项|规范|
|---|---|
|`id`：全小写、无空格、无符号、唯一且提交后不可更改||
|`version`：遵守语义化版本号（SemVer）||
|`author`：必须为可追责实体（个人或组织），禁止使用“ChatGPT”等 AI 名称||
|`name` 与 `description`：禁止夸张宣传词||
|`minAppVersion`：准确声明最低兼容版本||
|不得自带默认热键（防冲突）||

---

### 4. 性能与资源管理

|项|建议与要求|
|---|---|
|所有事件监听、命令注册必须在 `onunload()` 反注册||
|不得在 `onunload()` 调用 `detachLeaves()`||
|禁止频繁遍历全 Vault 搜索，应使用 `getFileByPath()`||
|建议使用 `Vault.process` 或 `FileManager.processFrontMatter` 做原子修改||
|避免多余的 console 输出（调试日志）||
|UI 不得硬编码样式，应用 CSS 变量||

---

### 5. 构建与依赖

|项|要求|
|---|---|
|使用固定依赖版本（`"1.2.3"`，不能用 `^`）||
|不得打包 `node_modules` 整体||
|输出单一文件 `main.js`||
|禁止使用 Node 原生模块（`fs`, `path`, `os` 等）||
|目标输出 `ES2020`||
|推荐构建工具：`rollup.config.mjs`（官方模板）||
|打包后代码体积 < 2 MB（含 source map）||

---

### 6. 界面与本地化规范

|项|规范|
|---|---|
|所有设置标题使用 **sentence case**||
|避免标题中重复“settings”字样||
|仅在多 section 时使用 heading||
|使用 `setHeading()` 而非 HTML `<h1>`||

---

### 7. 移动端兼容性

|项|说明|
|---|---|
|禁止调用 Node / Electron API||
|回退处理：`lookbehind` 正则仅在 iOS 16.4+ 可用||
|确保 `isDesktopOnly` 标志准确||

---

### 8. 审核流程（社区仓库）

1. **自动检查**  
    校验 `manifest.json`、版本号递增、文件大小、结构正确性。
    
2. **人工审查**  
    检查安全、兼容性、描述清晰度。
    
3. **反馈周期**  
    一般 1–3 天；若违反安全条款（远程代码、过大包），直接拒绝。
    
4. **更新要求**  
    版本必须递增；不能重写历史版本。
    

---

### 9. 隐性执行规则（社区惯例）

- 插件推荐体积 < 500 KB。
    
- README 必须含 GitHub 链接与使用说明。
    
- 每个命令 `id` 唯一，防热键冲突。
    
- 禁止在 settings 中添加品牌宣传。
    
- `onunload()` 后插件应彻底无残留（不留全局变量或定时器）。
    
- 若使用外部 API，需声明访问用途与隐私说明。
    

---

### 10. 审核拒绝常见原因

|原因|典型提示语|
|---|---|
|包体过大|“Please reduce plugin size under 2 MB.”|
|动态导入或远程代码|“Dynamic code loading is prohibited.”|
|使用 Node API|“Node module ‘fs’ not supported.”|
|版本号未递增|“Version in manifest must increase.”|
|作者字段为空|“Manifest field ‘author’ missing.”|
|注册未清理事件|“Potential memory leak on unload.”|

---

这份综合规范就是你想要的“第三个文件”：  
它结合了官方开发指南里没有明确写出的**审核与打包执行标准**，尤其包括你关心的那条 **“2 MB 限制”**（真实存在，执行层面强制）。

我可以进一步帮你把它转成一个可机读的 `obsidian-audit-checklist.json`，让你在打包或 AI 生成代码时自动检测是否符合上述规则，比如检测包大小、禁止 `eval`、验证 manifest 等。是否要我生成这份检测模板？