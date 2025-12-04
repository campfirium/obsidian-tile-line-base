import { t } from '../../i18n';
import { getLogger } from '../../utils/logger';

const logger = getLogger('grid:composition-proxy');

/**
 * CompositionProxy - 常驻合成代理�?
 *
 * 通过一个隐藏的 textarea 抢占焦点，让 IME 在正式编辑器初始化前就能完整接收按键�?
 * 代理层会在文本确定（ASCII 兜底�?compositionend）后交给上层回写�?
 */

export class CompositionProxy {
	private host: HTMLTextAreaElement;
	private ownerDocument: Document;
	private resolve?: (text: string) => void;
	private reject?: (err?: any) => void;
	private composing = false;
	private asciiTimer: number | null = null;
	private keyHandler?: (event: KeyboardEvent) => void;

	constructor(ownerDocument: Document = document) {
		this.ownerDocument = ownerDocument;

		const el = ownerDocument.createElement('textarea');
		el.setAttribute('wrap', 'off');
		el.setAttribute('autocomplete', 'off');
		el.setAttribute('autocorrect', 'off');
		el.setAttribute('autocapitalize', 'off');
		el.setAttribute('spellcheck', 'false');
		el.className = 'tlb-ime-capture';
		el.rows = 1;
		el.cols = 1;

		this.host = el;
		this.host.dataset.visible = 'false';
		ownerDocument.body.appendChild(el);

		this.host.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				this.cancel('cancelled');
				return;
			}
			this.keyHandler?.(event);
		});

		this.host.addEventListener('compositionstart', () => {
			this.composing = true;
			this.cancelAsciiFallback();
			this.host.value = '';
			try {
				this.host.setSelectionRange(0, 0);
			} catch (error) {
				logger.warn(t('compositionProxy.compositionResetFailed'), error);
			}
		});

		this.host.addEventListener('compositionend', (e: CompositionEvent) => {
			this.composing = false;
			const text = (e.data ?? this.host.value ?? '').toString();
			const resolve = this.resolve;
			this.cleanup();
			resolve?.(text);
		});

		this.host.addEventListener('input', (event) => {
			const inputEvent = event as InputEvent;

			if (inputEvent.isComposing || inputEvent.inputType === 'insertCompositionText') {
				this.composing = true;
				this.cancelAsciiFallback();
				return;
			}

			if (this.composing) {
				return;
			}

			this.scheduleAsciiFallback();
		});
	}

	private cancelAsciiFallback(): void {
		if (this.asciiTimer != null) {
			window.clearTimeout(this.asciiTimer);
			this.asciiTimer = null;
		}
	}

	private scheduleAsciiFallback(): void {
		this.cancelAsciiFallback();
		this.asciiTimer = window.setTimeout(() => {
			const text = (this.host.value ?? '').toString();
			const resolve = this.resolve;
			this.cleanup();
			resolve?.(text);
		}, 180);
	}

	private cleanup(): void {
		this.cancelAsciiFallback();
		this.composing = false;
		this.host.value = '';
		this.host.dataset.visible = 'false';

		const activeEl = this.ownerDocument.activeElement as HTMLElement | null;
		if (activeEl === this.host) {
			activeEl.blur?.();
		}

		this.resolve = undefined;
		this.reject = undefined;
		this.keyHandler = undefined;
	}

	captureOnceAt(rect: DOMRect): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;

			const w = Math.max(8, rect.width);
			const h = Math.max(16, rect.height);

			this.host.style.setProperty('--tlb-ime-left', `${Math.max(0, rect.left)}px`);
			this.host.style.setProperty('--tlb-ime-top', `${Math.max(0, rect.top)}px`);
			this.host.style.setProperty('--tlb-ime-width', `${w}px`);
			this.host.style.setProperty('--tlb-ime-height', `${h}px`);
			this.host.style.setProperty('--tlb-ime-line-height', `${h}px`);

			this.host.dataset.visible = 'true';

			this.composing = false;
			this.host.value = '';
			this.host.focus();
			try {
				this.host.setSelectionRange(0, 0);
			} catch (error) {
				logger.warn(t('compositionProxy.caretResetFailed'), error);
			}
		});
	}

	setKeyHandler(handler: ((event: KeyboardEvent) => void) | undefined): void {
		this.keyHandler = handler;
	}

	cancel(reason?: any): void {
		const reject = this.reject;
		if (!reject && !this.resolve) {
			this.cleanup();
			return;
		}

		this.resolve = undefined;
		this.reject = undefined;
		this.cleanup();
		reject?.(reason ?? 'cancelled');
	}

	destroy(): void {
		this.cancel('destroyed');
		if (this.host.parentNode) {
			this.host.parentNode.removeChild(this.host);
		}
	}
}

