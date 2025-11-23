export class SlideScaleManager {
	private readonly ownerWindow: Window | null;
	private activeSlide: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeCleanup: (() => void) | null = null;
	private scaleRaf: number | null = null;

	constructor(private readonly stage: HTMLElement, private readonly isFullscreen: () => boolean) {
		this.ownerWindow = stage.ownerDocument?.defaultView ?? null;
		this.attachResizeHandler();
	}

	setSlide(slide: HTMLElement | null): void {
		this.activeSlide = slide;
		this.resetSlideResizeObserver(slide);
		this.requestScale();
	}

	requestScale(): void {
		if (!this.ownerWindow) {
			this.applyScale();
			return;
		}
		if (!this.activeSlide) {
			this.cancelScaleUpdate();
			return;
		}
		this.cancelScaleUpdate();
		this.scaleRaf = this.ownerWindow.requestAnimationFrame(() => {
			this.scaleRaf = null;
			this.applyScale();
		});
	}

	dispose(): void {
		this.cancelScaleUpdate();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (this.resizeCleanup) {
			this.resizeCleanup();
			this.resizeCleanup = null;
		}
	}

	private attachResizeHandler(): void {
		if (!this.ownerWindow) return;
		const handler = () => this.requestScale();
		this.ownerWindow.addEventListener('resize', handler);
		this.resizeCleanup = () => this.ownerWindow?.removeEventListener('resize', handler);
	}

	private resetSlideResizeObserver(slide: HTMLElement | null): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (!slide || typeof ResizeObserver === 'undefined') return;
		this.resizeObserver = new ResizeObserver(() => this.requestScale());
		this.resizeObserver.observe(slide);
	}

	/* eslint-disable obsidianmd/no-static-styles-assignment */
	private applyScale(): void {
		const slide = this.activeSlide;
		if (!slide) return;
		if (!this.isFullscreen()) {
			slide.style.setProperty('--tlb-slide-scale', '1');
			return;
		}
		const stageWidth = this.stage.clientWidth;
		const stageHeight = this.stage.clientHeight;
		const baseWidth = slide.offsetWidth;
		const baseHeight = slide.offsetHeight;
		if (!stageWidth || !stageHeight || !baseWidth || !baseHeight) {
			slide.style.setProperty('--tlb-slide-scale', '1');
			return;
		}
		const scale = Math.min(stageWidth / baseWidth, stageHeight / baseHeight);
		slide.style.setProperty('--tlb-slide-scale', `${scale}`);
	}
	/* eslint-enable obsidianmd/no-static-styles-assignment */

	private cancelScaleUpdate(): void {
		if (this.scaleRaf != null && this.ownerWindow) {
			this.ownerWindow.cancelAnimationFrame(this.scaleRaf);
		}
		this.scaleRaf = null;
	}
}
