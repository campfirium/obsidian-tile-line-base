# T0001 - AgGrid adapter refactor

## Context
- Spec: specs/251024 AgGridAdapter 拆分方案.md
- Trigger: AgGridAdapter 现状复杂度与测试性不足，需要拆分落地

## Phase 0 checklist
- [x] 列出 AgGridAdapter 对外回调与调用方（TableView、GridController 等）映射关系
- [x] 梳理内部状态字段与拟拆分模块的对应关系
- [x] 为列宽算法、cloneColumnState 等纯函数准备最小验证脚本或单测草案
- [x] 盘点输入法、剪贴板、快捷键的回归脚本
- [x] 梳理拆分过程中需同步更新的 i18n 字段与文档

## Phase 1 progress
- [x] 列服务抽离：src/grid/column/AgGridColumnService.ts 接管列定义/列宽/排序/状态管理
- [x] 销毁与回调解绑逻辑收敛到列服务，AgGridAdapter 不再直接持有 columnApi 等字段
- [x] 回归验证：Windows Node 18 环境执行 `npm install && npm run build`，确认 @esbuild/win32-x64 正常，输出已记录
- [x] 列服务最小验证脚本补齐（scripts/dev/verify-column-service.ts）并在 README 追加运行方式

## Phase 2（Lifecycle & API 管理）
- [x] 新增 src/grid/lifecycle/AgGridLifecycleManager.ts，封装 mountGrid、destroy、runWhenReady、onModelUpdated
- [x] AgGridAdapter 通过生命周期管理器获取 GridApi/ColumnApi，移除内部 gridApi/ready 字段管理
- [x] 视口监听与 proxyRealignTimer 的注册/注销通过生命周期 onAttach 返回的清理函数统一管理
- [x] AgGridColumnService.attachApis 触发时机交由生命周期管理器的 onGridReady 回调
- [x] 抽象 onViewportResize 回调供交互控制层复用
- [x] 生命周期管理器内补充 withApis/withColumnApi 语义化封装
- [x] 生命周期管理模块的最小验证脚本（scripts/dev/verify-lifecycle-manager.ts）

## Notes
- 新增或调整的回归、验证脚本请同步登记到 scripts/ 并在 README 写明使用方式
- 生命周期管理拆分涉及的行为变更，持续在 specs/251024 AgGridAdapter 拆分方案.md 中补充结论与风险

## 2025-10-28 进展纪要
- 在 Windows 原生环境执行 `npm install && npm run build`，构建通过
- 新建 src/grid/lifecycle/AgGridLifecycleManager.ts 并接入 AgGridAdapter
- AgGridAdapter 构造函数改为注册生命周期 ready/modelUpdated 回调，销毁流程统一走管理器
- README.md 新增列服务验证脚本与生命周期验证脚本的调用示例
- scripts/dev/verify-lifecycle-manager.ts 用于覆盖生命周期 ready/attach/destroy 行为

## Phase 3（Interaction Controller 拆分准备）
- [x] 目标：将焦点/键盘/复制等交互逻辑迁移到 `src/grid/interactions/AgGridInteractionController.ts`
- [x] 梳理 `AgGridAdapter` 中交互相关字段与方法（焦点记录、CompositionProxy、键盘处理、复制）
- [x] 设计交互控制器的依赖注入接口（GridApi 访问、上下文回调、列服务委托）
- [ ] 更新 specs/251024 AgGridAdapter 拆分方案.md，补充 Phase 3 设计概述
- [x] 预备验证脚本，确保迁移后 `ts-node` 验证用例覆盖交互行为（`scripts/dev/verify-interaction-controller.ts`）


