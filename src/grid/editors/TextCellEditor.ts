/**
 * TextCellEditor - 自定义文本编辑器
 *
 * 修复 AG Grid 默认编辑器在按键启动编辑时丢失首字符的问题
 * AG Grid 34+ 使用 eventKey 参数传递启动编辑的按键
 *
 * 注意：使用工厂函数而非类，以支持 Obsidian pop-out 窗口（避免跨窗口原型链问题）
 */

import { ICellEditorComp, ICellEditorParams } from 'ag-grid-community';

// 保留类定义用于类型
export class TextCellEditor implements ICellEditorComp {
	private eInput!: HTMLInputElement;
	private params!: ICellEditorParams;
	private initialValue: string = '';

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

		// 获取初始值
		this.initialValue = params.value ?? '';

		// AG Grid 34+ 使用 eventKey 传递按键（旧版本使用 key 或 charPress）
		const eventKey = (params as any).eventKey;

		// 🔍 详细调试日志
		console.log('=== TextCellEditor.init 开始 ===');
		console.log('Full params:', params);
		console.log('params.eGridCell:', params.eGridCell);
		console.log('params.eGridCell?.ownerDocument:', params.eGridCell?.ownerDocument);
		console.log('ownerDocument === document:', (params.eGridCell?.ownerDocument === document));
		console.log('eventKey:', eventKey);
		console.log('params.charPress:', (params as any).charPress);
		console.log('params.key:', (params as any).key);
		console.log('params.keyPress:', (params as any).keyPress);
		console.log('initialValue:', this.initialValue);
		console.log('=== TextCellEditor.init 结束 ===');

		if (eventKey && eventKey.length === 1) {
			// 如果是单字符按键启动编辑，用这个字符作为初始值
			console.log('Using eventKey as initial value:', eventKey);
			this.eInput.value = eventKey;
		} else {
			// 否则使用原有值
			console.log('Using original value:', this.initialValue);
			this.eInput.value = this.initialValue;
		}

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
		// 聚焦并选中所有文本（如果有eventKey就光标在末尾）
		this.eInput.focus();
		const eventKey = (this.params as any).eventKey;
		if (eventKey && eventKey.length === 1) {
			// 有启动字符时，光标移到末尾
			this.eInput.setSelectionRange(this.eInput.value.length, this.eInput.value.length);
		} else {
			// 没有启动字符时，全选
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
}

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
		private initialValue: string = '';
		private isComposing: boolean = false; // 标记是否在输入法组合中

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

			// 获取初始值
			this.initialValue = params.value ?? '';

			// AG Grid 34+ 使用 eventKey 传递按键（旧版本使用 key 或 charPress）
			const eventKey = (params as any).eventKey;
			// 🔑 在 pop-out 窗口中，AG Grid 不传递 eventKey，使用我们手动捕获的按键
			const manualEventKey = (params as any).manualEventKey;
			// 优先使用 AG Grid 的 eventKey，如果没有则使用手动捕获的
			const actualKey = eventKey || manualEventKey;

			// 🔍 详细调试日志
			console.log('=== TextCellEditor.init 开始 (工厂版本) ===');
			console.log('Full params:', params);
			console.log('params.eGridCell:', params.eGridCell);
			console.log('params.eGridCell?.ownerDocument:', params.eGridCell?.ownerDocument);
			console.log('ownerDocument === document:', (params.eGridCell?.ownerDocument === document));
			console.log('eventKey:', eventKey);
			console.log('manualEventKey:', manualEventKey);
			console.log('actualKey:', actualKey);
			console.log('params.charPress:', (params as any).charPress);
			console.log('params.key:', (params as any).key);
			console.log('params.keyPress:', (params as any).keyPress);
			console.log('initialValue:', this.initialValue);
			console.log('=== TextCellEditor.init 结束 ===');

			if (actualKey && actualKey.length === 1) {
				// 如果是单字符按键启动编辑，用这个字符作为初始值
				console.log('Using actualKey as initial value:', actualKey);
				this.eInput.value = actualKey;
			} else {
				// 否则使用原有值
				console.log('Using original value:', this.initialValue);
				this.eInput.value = this.initialValue;
			}

			// 🔑 处理输入法组合事件（中文输入等）
			this.eInput.addEventListener('compositionstart', (e: CompositionEvent) => {
				this.isComposing = true;
				console.log('[TextCellEditor] 输入法组合开始, data:', e.data);

				// 如果我们之前捕获了首字符（actualKey），需要把它还给输入法
				if (actualKey && actualKey.length === 1 && this.eInput.value === actualKey) {
					console.log('[TextCellEditor] 检测到输入法，需要恢复首字符:', actualKey);

					// 恢复原值
					this.eInput.value = this.initialValue;

					// 🔑 尝试把首字符重新插入，让输入法能识别
					// 注意：这可能不会完美工作，因为输入法已经启动了
					const selStart = this.eInput.selectionStart || 0;
					const selEnd = this.eInput.selectionEnd || 0;
					const currentValue = this.eInput.value;

					// 在光标位置插入字符
					this.eInput.value =
						currentValue.substring(0, selStart) +
						actualKey +
						currentValue.substring(selEnd);

					// 设置光标位置到字符后面
					this.eInput.setSelectionRange(selStart + 1, selStart + 1);

					console.log('[TextCellEditor] 已尝试恢复字符，当前值:', this.eInput.value);
				}
			});

			this.eInput.addEventListener('compositionend', () => {
				this.isComposing = false;
				console.log('[TextCellEditor] 输入法组合结束，当前值:', this.eInput.value);
			});

			// 添加键盘事件处理
			this.eInput.addEventListener('keydown', (event) => {
				// Enter 或 Tab 提交编辑
				if (event.key === 'Enter' || event.key === 'Tab') {
					// 如果正在输入法组合中，Enter 是确认输入，不提交编辑
					if (this.isComposing) {
						return;
					}
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
			// 聚焦并选中所有文本（如果有eventKey就光标在末尾）
			this.eInput.focus();
			const eventKey = (this.params as any).eventKey;
			const manualEventKey = (this.params as any).manualEventKey;
			const actualKey = eventKey || manualEventKey;
			if (actualKey && actualKey.length === 1) {
				// 有启动字符时，光标移到末尾
				this.eInput.setSelectionRange(this.eInput.value.length, this.eInput.value.length);
			} else {
				// 没有启动字符时，全选
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
