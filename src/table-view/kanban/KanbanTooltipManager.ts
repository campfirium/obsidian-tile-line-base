interface TooltipHandlers {
	enter: () => void;
	leave: () => void;
	move: () => void;
}

export class KanbanTooltipManager {
	private handlers = new WeakMap<HTMLElement, TooltipHandlers>();
	private tooltipEl: HTMLElement | null = null;
	private anchorEl: HTMLElement | null = null;
	private globalsDoc: Document | null = null;
	private readonly globalListener = () => this.hide();

	register(anchor: HTMLElement, text: string): void {
		if (!text || text.trim().length === 0) {
			return;
		}
		anchor.setAttr('data-tlb-tooltip', text);
		anchor.removeAttribute('aria-describedby');
		let callbacks = this.handlers.get(anchor);
		if (!callbacks) {
			callbacks = {
				enter: () => this.show(anchor),
				leave: () => this.hide(),
				move: () => this.updatePosition(anchor)
			};
			this.handlers.set(anchor, callbacks);
			anchor.addEventListener('mouseenter', callbacks.enter);
			anchor.addEventListener('mouseleave', callbacks.leave);
			anchor.addEventListener('focus', callbacks.enter);
			anchor.addEventListener('blur', callbacks.leave);
			anchor.addEventListener('mousemove', callbacks.move);
		}
	}

	unregister(anchor: HTMLElement): void {
		anchor.removeAttribute('data-tlb-tooltip');
		anchor.removeAttribute('aria-describedby');
		const callbacks = this.handlers.get(anchor);
		if (callbacks) {
			anchor.removeEventListener('mouseenter', callbacks.enter);
			anchor.removeEventListener('mouseleave', callbacks.leave);
			anchor.removeEventListener('focus', callbacks.enter);
			anchor.removeEventListener('blur', callbacks.leave);
			anchor.removeEventListener('mousemove', callbacks.move);
			this.handlers.delete(anchor);
		}
		if (this.anchorEl === anchor) {
			this.hide();
		}
	}

	hide(): void {
		if (this.globalsDoc) {
			this.globalsDoc.removeEventListener('scroll', this.globalListener, true);
			this.globalsDoc.defaultView?.removeEventListener('resize', this.globalListener);
			this.globalsDoc = null;
		}
		if (this.tooltipEl) {
			this.tooltipEl.removeClass('is-visible');
			try {
				this.tooltipEl.remove();
			} catch {
				// ignore
			}
			this.tooltipEl = null;
		}
		if (this.anchorEl) {
			this.anchorEl.removeAttribute('aria-describedby');
			this.anchorEl = null;
		}
	}

	destroy(): void {
		this.hide();
		this.handlers = new WeakMap<HTMLElement, TooltipHandlers>();
	}

	private show(anchor: HTMLElement): void {
		const text = anchor.getAttribute('data-tlb-tooltip');
		if (!text || text.trim().length === 0) {
			return;
		}
		const doc = anchor.ownerDocument;
		const tooltip = this.ensureTooltipElement(doc);
		tooltip.removeClass('is-visible');
		tooltip.setText(text);
		if (!tooltip.id) {
			tooltip.id = 'tlb-kanban-tooltip';
		}
		anchor.setAttr('aria-describedby', tooltip.id);
		this.anchorEl = anchor;
		this.attachGlobalListeners(doc);
		requestAnimationFrame(() => {
			if (this.anchorEl !== anchor) {
				return;
			}
			this.updatePosition(anchor);
			tooltip.addClass('is-visible');
		});
	}

	private ensureTooltipElement(doc: Document): HTMLElement {
		if (!this.tooltipEl || !this.tooltipEl.isConnected || this.tooltipEl.ownerDocument !== doc) {
			if (this.tooltipEl && this.tooltipEl.isConnected) {
				this.tooltipEl.remove();
			}
			this.tooltipEl = doc.body.createDiv({ cls: 'tlb-kanban-tooltip' });
		} else if (this.tooltipEl.parentElement !== doc.body) {
			doc.body.appendChild(this.tooltipEl);
		}
		return this.tooltipEl;
	}

	private updatePosition(anchor: HTMLElement): void {
		if (!this.tooltipEl || this.anchorEl !== anchor) {
			return;
		}
		const doc = anchor.ownerDocument;
		const view = doc.defaultView ?? window;
		const anchorRect = anchor.getBoundingClientRect();
		const tooltipRect = this.tooltipEl.getBoundingClientRect();
		const anchorStyle = view.getComputedStyle(anchor);
		const paddingLeft = Number.parseFloat(anchorStyle.paddingLeft || '0');
		const paddingRight = Number.parseFloat(anchorStyle.paddingRight || '0');
		const innerWidth = Math.max(0, anchorRect.width - paddingLeft - paddingRight);
		let left = anchorRect.left + paddingLeft;
		let top = anchorRect.top - tooltipRect.height - 8;
		this.tooltipEl.style.width = `${innerWidth}px`;
		if (top < 8) {
			top = anchorRect.bottom + 8;
			if (top + tooltipRect.height > view.innerHeight - 8) {
				top = Math.max(8, view.innerHeight - tooltipRect.height - 8);
			}
		}
		this.tooltipEl.style.left = `${left}px`;
		this.tooltipEl.style.top = `${top}px`;
	}

	private attachGlobalListeners(doc: Document): void {
		if (this.globalsDoc === doc) {
			return;
		}
		if (this.globalsDoc) {
			this.globalsDoc.removeEventListener('scroll', this.globalListener, true);
			this.globalsDoc.defaultView?.removeEventListener('resize', this.globalListener);
		}
		doc.addEventListener('scroll', this.globalListener, true);
		doc.defaultView?.addEventListener('resize', this.globalListener, { passive: true });
		this.globalsDoc = doc;
	}
}
