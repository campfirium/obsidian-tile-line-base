/**
 * TextCellEditor - 自定义文本编辑器
 *
 * 配合 CompositionProxy（合成代理层）使用：
 * - 首字符由 CompositionProxy 捕获后写�?
 * - 编辑器只负责显示和后续编�?
 * - 不再使用 params.eventKey �?params.charPress（已废弃�?
 *
 * 参考文档：
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记�?.md
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记�?分析.md
 *
 * 注意：使用工厂函数而非类，以支�?Obsidian pop-out 窗口（避免跨窗口原型链问题）
 */

import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';

/**
 * 创建 TextCellEditor 的工厂函�?
 *
 * 使用纯对象而不是类实例，避免跨窗口原型链问�?
 * 这样�?Obsidian pop-out 窗口中也能正常工�?
 */
export function createTextCellEditor() {
	return class implements ICellEditorComp {
		private eInput!: HTMLInputElement;
		private params!: ICellEditorParams;
		private initialValue = '';

		init(params: ICellEditorParams): void {
			this.params = params;

			// �?AG Grid 的单元格元素获取正确�?document（支�?pop-out 窗口�?
			const doc = (params.eGridCell?.ownerDocument || document);

			// 创建输入�?
			this.eInput = doc.createElement('input');
			this.eInput.type = 'text';
			this.eInput.classList.add('ag-cell-edit-input', 'tlb-text-editor-input');

			// 只使用原值，不使�?params.eventKey/charPress
			// 首字符会�?AgGridAdapter 通过 CompositionProxy 捕获后写�?
			this.initialValue = String(params.value ?? '');
			this.eInput.value = this.initialValue;

			// 添加键盘事件处理
			this.eInput.addEventListener('keydown', (event) => {
				// Enter �?Tab 提交编辑
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
			// 聚焦输入�?
			this.eInput.focus();

			// 如果是双击启动（有原值），全�?
			// 如果是按键启动（原值为空），光标在开头（等待 AgGridAdapter 写入文本�?
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


