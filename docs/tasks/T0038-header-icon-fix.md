# T0038-header-icon-fix

## 问题描述

表格标题行的序号列（`#`）和状态列（`status`）图标显示异常：
- 图标在表格初始化时闪烁两次
- 图标在某些情况下会消失
- 列宽调整时图标会闪烁

## 根本原因

1. **过度频繁的图标重绘**
   - `columnResized` 事件在拖动列宽时频繁触发
   - 每次触发都会调用 `setIcon()` 重新设置图标
   - 导致图标 SVG 被反复创建和替换，产生闪烁

2. **缺少图标存在性检查**
   - 没有检查图标元素是否已存在且包含 SVG
   - 即使图标已正确显示，也会重新调用 `setIcon()`

## 解决方案

### 1. 优化图标更新逻辑

```typescript
// 添加图标存在性检查
let iconEl = headerCell.querySelector<HTMLElement>(`.${config.iconClass}`);
const needsIconCreation = !iconEl;

if (needsIconCreation) {
    iconEl = doc.createElement('div');
    iconEl.className = config.iconClass;
    label.insertBefore(iconEl, label.firstChild ?? null);
}

// 只在图标不存在或 SVG 丢失时才重新设置图标
if (needsIconCreation || !iconEl!.querySelector('svg')) {
    setIcon(iconEl!, config.icon);
    // ... fallback 逻辑
}
```

### 2. 移除不必要的事件监听

从事件监听列表中移除 `columnResized`：

```typescript
const events = [
    'firstDataRendered',
    'columnEverythingChanged',
    'displayedColumnsChanged',
    'sortChanged'
    // 移除了 'columnResized'
] as const;
```

## 修改文件

- [src/grid/AgGridAdapter.ts](../../src/grid/AgGridAdapter.ts)
  - 修改 `updateHeaderIcons()` 方法
  - 修改 `setupHeaderIcons()` 中的事件监听列表

## 技术细节

### 优化前
```typescript
// 每次都重新设置图标
setIcon(iconEl, config.icon);
```

### 优化后
```typescript
// 仅在必要时设置图标
if (needsIconCreation || !iconEl!.querySelector('svg')) {
    setIcon(iconEl!, config.icon);
}
```

## 预期效果

- ✅ 图标不再闪烁
- ✅ 列宽调整时图标保持稳定显示
- ✅ 减少不必要的 DOM 操作
- ✅ 提升性能

## 测试要点

- [ ] 打开表格，图标正常显示
- [ ] 拖动列宽，图标不闪烁
- [ ] 排序列，图标保持显示
- [ ] 刷新表格，图标正确重新加载
