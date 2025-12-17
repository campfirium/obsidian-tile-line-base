import type { Component } from 'obsidian';
import { resetRenderArtifacts } from '../slide/SlideRenderUtils';
import { ensureGallerySlide } from './galleryDomUtils';

export interface GalleryCardSlot {
	cardEl: HTMLElement;
	slideEl: HTMLElement;
	renderCleanup: Array<() => void>;
	markdownComponents: Component[];
}

export interface GalleryCardSlotEntry {
	pageIndex: number;
	slot: GalleryCardSlot;
	shouldRender: boolean;
}

export class GalleryCardDeck {
	private readonly slotPool: GalleryCardSlot[] = [];
	private readonly slotsByPageIndex = new Map<number, GalleryCardSlot>();

	reconcileRange(options: {
		grid: HTMLElement;
		start: number;
		end: number;
		invalidate?: boolean;
	}): GalleryCardSlotEntry[] {
		const start = Math.max(0, options.start);
		const end = Math.max(start, options.end);
		const invalidate = options.invalidate === true;
		this.releaseOutsideRange(start, end);

		const results: GalleryCardSlotEntry[] = [];
		for (let pageIndex = start; pageIndex < end; pageIndex += 1) {
			const existing = this.slotsByPageIndex.get(pageIndex) ?? null;
			const slot = existing ?? this.acquire(options.grid);
			if (!existing) {
				this.slotsByPageIndex.set(pageIndex, slot);
			}
			const shouldRender = invalidate || !existing;
			if (shouldRender) {
				this.resetSlot(slot);
			}
			options.grid.appendChild(slot.cardEl);
			results.push({ pageIndex, slot, shouldRender });
		}
		return results;
	}

	clear(): void {
		for (const slot of this.slotsByPageIndex.values()) {
			this.release(slot);
		}
		this.slotsByPageIndex.clear();
		for (const slot of this.slotPool) {
			this.release(slot);
		}
		this.slotPool.length = 0;
	}

	private acquire(grid: HTMLElement): GalleryCardSlot {
		const slot = this.slotPool.pop();
		if (slot) {
			return slot;
		}
		const cardEl = grid.createDiv({ cls: 'tlb-gallery-card' });
		const slideEl = ensureGallerySlide(cardEl);
		return {
			cardEl,
			slideEl,
			renderCleanup: [],
			markdownComponents: []
		};
	}

	private resetSlot(slot: GalleryCardSlot): void {
		resetRenderArtifacts(slot.renderCleanup, slot.markdownComponents);
		slot.cardEl.onclick = null;
		slot.cardEl.oncontextmenu = null;
		slot.slideEl.empty();
	}

	private release(slot: GalleryCardSlot): void {
		this.resetSlot(slot);
		slot.cardEl.remove();
	}

	private releaseOutsideRange(start: number, end: number): void {
		const released: number[] = [];
		for (const pageIndex of this.slotsByPageIndex.keys()) {
			if (pageIndex < start || pageIndex >= end) {
				released.push(pageIndex);
			}
		}
		for (const pageIndex of released) {
			const slot = this.slotsByPageIndex.get(pageIndex);
			if (!slot) {
				continue;
			}
			this.slotsByPageIndex.delete(pageIndex);
			this.release(slot);
			this.slotPool.push(slot);
		}
	}
}

