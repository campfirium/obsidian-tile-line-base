type PasteOrigin = 'keydown' | 'dom' | 'onPasteEnd';

type LogFn = (label: string, details?: unknown) => void;

type StopResult = 'success' | 'pending' | 'noApi';

interface PasteExitControllerOptions {
	stopEditing: (reason: string) => StopResult;
	log: LogFn;
}

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 24;
const RESET_DELAY_MS = 250;

export class PasteExitController {
	private pending = false;
	private resetTimer: number | null = null;
	private exitTimer: number | null = null;
	private attempts = 0;
	private doc: Document | null = null;
	private pasteListener: ((event: ClipboardEvent) => void) | null = null;

	constructor(private readonly options: PasteExitControllerOptions) {}

	bindDocument(doc: Document | null): void {
		if (this.doc === doc) {
			return;
		}
		this.detachListener();
		this.doc = doc;
		if (!doc) {
			return;
		}
		this.pasteListener = (event: ClipboardEvent) => this.handleDomPaste(event);
		doc.addEventListener('paste', this.pasteListener, true);
	}

	handleKeydown(meta: { rowIndex: number | null; colId: string | null }): void {
		this.startPending('keydown', meta);
	}

	handleDomPaste(event: ClipboardEvent): void {
		const target = event.target as HTMLElement | null;
		this.startPending('dom', {
			targetTag: target?.tagName ?? null,
			clipboardTypes: event.clipboardData ? Array.from(event.clipboardData.types || []) : null
		});
	}

		handlePasteEnd(): void {
		this.options.log('onPasteEnd');
		if (this.pending) {
			this.scheduleExit(true);
		}
	}

	handleEditingStarted(): void {
		this.options.log('editingStarted', { pending: this.pending });
		if (!this.pending) {
			return;
		}
		this.scheduleExit(true);
	}

	destroy(): void {
		this.pending = false;
		this.clearResetTimer();
		if (this.exitTimer != null) {
			window.clearTimeout(this.exitTimer);
			this.exitTimer = null;
		}
		this.detachListener();
	}

	private startPending(origin: PasteOrigin, detail?: unknown): void {
		this.pending = true;
		this.attempts = 0;
		this.options.log('pending', { origin, detail });
		this.clearResetTimer();
		this.resetTimer = window.setTimeout(() => {
			this.pending = false;
			this.resetTimer = null;
			this.options.log('timeout');
		}, RESET_DELAY_MS);
	}

	private scheduleExit(immediate: boolean): void {
		if (!this.pending) {
			return;
		}
		if (this.exitTimer != null) {
			window.clearTimeout(this.exitTimer);
		}
		this.exitTimer = window.setTimeout(() => {
			this.exitTimer = null;
			if (!this.pending) {
				return;
			}
			const result = this.options.stopEditing('paste');
			if (result === 'success') {
				this.finish('stopped');
				return;
			}
			if (result === 'noApi') {
				this.finish('noApi');
				return;
			}
			this.attempts += 1;
			if (this.attempts >= MAX_ATTEMPTS) {
				this.options.log('maxAttempts', { attempts: this.attempts });
				this.attempts = 0;
			}
			this.scheduleExit(false);
		}, immediate ? 0 : RETRY_DELAY_MS);
	}

	private finish(reason: string): void {
		this.pending = false;
		this.clearResetTimer();
		this.options.log(reason, { attempts: this.attempts });
	}

	private clearResetTimer(): void {
		if (this.resetTimer != null) {
			window.clearTimeout(this.resetTimer);
			this.resetTimer = null;
		}
	}

	private detachListener(): void {
		if (this.doc && this.pasteListener) {
			this.doc.removeEventListener('paste', this.pasteListener, true);
		}
		this.doc = null;
		this.pasteListener = null;
	}
}
