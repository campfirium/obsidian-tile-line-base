# T0016 - Excel 式单元格交互

**目标**：实现 Excel 风格的单元格选中和编辑分离

## 任务清单

- [ ] 左键单击：只选中单元格，不进入编辑
- [ ] 双击：进入编辑模式
- [ ] F2：进入编辑模式
- [ ] Enter：移动到下一行同一列
- [ ] 最后一行 Enter：新增一行并进入编辑

## 实现说明

### AG Grid 配置
需要配置以下选项：
- `singleClickEdit: false` - 禁用单击编辑
- `enterNavigatesVertically: true` - Enter 键垂直导航
- `enterNavigatesVerticallyAfterEdit: true` - 编辑后 Enter 垂直导航

### 键盘事件处理
- 监听 F2 键进入编辑模式
- 监听 Enter 键，判断是否在最后一行
  - 非最后一行：默认行为（移动到下一行）
  - 最后一行：新增一行并进入编辑状态

## 相关文件
- `src/grid/AgGridAdapter.ts` - AG Grid 配置
- `src/TableView.ts` - 键盘事件处理、新增行逻辑
