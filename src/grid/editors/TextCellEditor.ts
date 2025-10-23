/**
 * TextCellEditor - 自定义文本编辑器
 *
 * 配合 CompositionProxy（合成代理层）使用：
 * - 首字符由 CompositionProxy 捕获后写入
 * - 编辑器只负责显示和后续编辑
 * - 不再使用 params.eventKey 或 params.charPress（已废弃）
 *
 * 参考文档：
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2.md
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2分析.md
 *
 * 注意：使用工厂函数而非类，以支持 Obsidian pop-out 窗口（避免跨窗口原型链问题）
 */

import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';

/**
 * 创建 TextCellEditor 的工厂函数
 *
 * 使用纯对象而不是类实例，避免跨窗口原型链问题
 * 这样在 Obsidian pop-out 窗口中也能正常工作
 */
export function createTextCellEditor() {
	return class implements ICellEditorComp {
		private eInput!: HTMLInputElement;
		private params!: ICellEditorParams;
		private initialValue = '';

		init(params: ICellEditorParams): void {
			this.params = params;

			// 从 AG Grid 的单元格元素获取正确的 document（支持 pop-out 窗口）
			const doc = (params.eGridCell?.ownerDocument || document);

			// 创建输入框
			this.eInput = doc.createElement('input');
			this.eInput.type = 'text';
			this.eInput.classList.add('ag-cell-edit-input');
			this.eInput.style.width = '100%';
			this.eInput.style.height = '100%';

			// 只使用原值，不使用 params.eventKey/charPress
			// 首字符会由 AgGridAdapter 通过 CompositionProxy 捕获后写入
			this.initialValue = String(params.value ?? '');
			this.eInput.value = this.initialValue;

			// 添加键盘事件处理
			this.eInput.addEventListener('keydown', (event) => {
				// Enter 或 Tab 提交编辑
				if (event.key === 'Enter' || event.key === 'Tab') {
					event.stopPropagation();
					params.stopEditing(false);
				}
				// Escape 取消编辑
				else if (event.key === 'Escape') {
					event.stopPropagation();
					params.stopEditing(true);
				}
			});
		}

		getGui(): HTMLElement {
			return this.eInput;
		}

		afterGuiAttached(): void {
			// 聚焦输入框
			this.eInput.focus();

			// 如果是双击启动（有原值），全选
			// 如果是按键启动（原值为空），光标在开头（等待 AgGridAdapter 写入文本）
			if (this.initialValue) {
				this.eInput.select();
			}
		}

		getValue(): string {
			return this.eInput.value;
		}

		destroy(): void {
			// 清理资源
		}

		isPopup(): boolean {
			return false;
		}
	};
}
