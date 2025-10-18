/**
 * CompositionProxy - 合成代理层
 *
 * 用于解决 AG Grid 按键启动编辑与 IME（输入法）冲突的问题。
 *
 * 核心思路：
 * 1. 在单元格上创建一个透明的 contenteditable 元素作为"代理层"
 * 2. 首键落到已聚焦的代理层，IME 在此完成组合
 * 3. 组合完成后，将文本写回 AG Grid 的真正编辑器
 *
 * 参考文档：
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2.md
 * - docs/specs/251018 AG-Grid AG-Grid单元格编辑与输入法冲突尝试记录2分析.md
 */

export class CompositionProxy {
	private host: HTMLDivElement;
	private ownerDocument: Document;
	private resolve?: (text: string) => void;
	private reject?: (err?: any) => void;
	private composing = false;
	private asciiTimer: number | null = null;

	constructor(ownerDocument: Document = document) {
		this.ownerDocument = ownerDocument;

		// 创建代理层 DOM 元素
		const el = ownerDocument.createElement('div');
		el.setAttribute('contenteditable', 'true');

		// 样式设置：视觉透明但保留布局（避免候选窗锚点偏移）
		Object.assign(el.style, {
			position: 'fixed',
			zIndex: '2147483647', // 最高层级
			// 视觉透明（比纯 opacity:0 更稳定）
			color: 'transparent',
			caretColor: 'transparent',
			background: 'transparent',
			outline: 'none',
			whiteSpace: 'pre',
			pointerEvents: 'none', // 不影响鼠标事件
			// 不要设置 display:none 或 visibility:hidden（会导致 IME 候选窗不弹出）
		} as CSSStyleDeclaration);

		this.host = el;
		ownerDocument.body.appendChild(el);

		// 监听 IME 组合事件
		this.host.addEventListener('compositionstart', () => {
			this.composing = true;
			console.log('[CompositionProxy] compositionstart - 开始 IME 组合');
		});

		this.host.addEventListener('compositionend', (e: CompositionEvent) => {
			this.composing = false;
			const text = (e.data ?? this.host.textContent ?? '').toString();
			console.log('[CompositionProxy] compositionend - IME 组合结束');
			console.log('  event.data:', e.data);
			console.log('  textContent:', this.host.textContent);
			console.log('  最终文本:', text);
			this.cleanup();
			this.resolve?.(text);
		});

		// ASCII 快速路径：未进入组合，短延迟后直接拿文本
		this.host.addEventListener('input', () => {
			if (!this.composing && this.asciiTimer == null) {
				this.asciiTimer = window.setTimeout(() => {
					const text = (this.host.textContent ?? '').toString();
					console.log('[CompositionProxy] ASCII 快速路径触发，文本:', text);
					this.cleanup();
					this.resolve?.(text);
				}, 32); // 32ms 延迟，确保输入完成
			}
		});

		// 保险：Esc 取消输入
		this.host.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				console.log('[CompositionProxy] Esc 取消输入');
				this.cleanup();
				this.reject?.('cancelled');
			}
		});
	}

	/**
	 * 清理代理层状态
	 */
	private cleanup() {
		// 清除超时定时器
		if (this.asciiTimer != null) {
			window.clearTimeout(this.asciiTimer);
			this.asciiTimer = null;
		}

		// 清空内容
		this.host.textContent = '';

		// 让出焦点（避免后续键继续落到代理层）
		const activeEl = this.ownerDocument.activeElement as HTMLElement | null;
		if (activeEl === this.host) {
			activeEl.blur?.();
		}

		console.log('[CompositionProxy] cleanup 完成');
	}

	/**
	 * 在指定矩形处激活代理层并捕获一次文本（ASCII 或 IME 最终产物）
	 *
	 * @param rect 单元格的可视矩形
	 * @returns Promise，resolve 为捕获的文本
	 */
	captureOnceAt(rect: DOMRect): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;

			// 计算代理层的位置和尺寸
			const w = Math.max(8, rect.width); // 最小宽度 8px
			const h = Math.max(16, rect.height); // 最小高度 16px

			// 定位到单元格位置
			Object.assign(this.host.style, {
				left: `${Math.max(0, rect.left)}px`,
				top: `${Math.max(0, rect.top)}px`,
				width: `${w}px`,
				height: `${h}px`,
				lineHeight: `${h}px`, // 行高与单元格高度匹配，稳定候选窗锚点
			});

			console.log('[CompositionProxy] 激活代理层');
			console.log('  位置:', { left: rect.left, top: rect.top, width: w, height: h });

			// 清空内容并聚焦
			this.host.textContent = '';
			this.host.focus();

			console.log('[CompositionProxy] 已聚焦，等待输入...');
		});
	}

	/**
	 * 销毁代理层
	 */
	destroy(): void {
		this.cleanup();
		if (this.host.parentNode) {
			this.host.parentNode.removeChild(this.host);
		}
	}
}
