import { normalizeSlideViewConfig, type SlideViewConfig } from '../../types/slide';

export interface GalleryViewDefinition {
	id: string;
	name: string;
	template: SlideViewConfig;
	cardWidth?: number | null;
	cardHeight?: number | null;
	groupField?: string | null;
}

export interface GalleryViewState {
	views: GalleryViewDefinition[];
	activeViewId: string | null;
}

const createId = (): string => `gal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_CARD_WIDTH = 320;
const DEFAULT_CARD_HEIGHT = 320;
const normalizeSize = (value: unknown, fallback: number): number => {
	const numeric = typeof value === 'number' ? value : Number(value);
	if (Number.isFinite(numeric) && numeric > 40 && numeric < 2000) {
		return numeric;
	}
	return fallback;
};

const deriveSizeFromAspect = (aspect: unknown): { width: number; height: number } | null => {
	const ratio = typeof aspect === 'number' ? aspect : Number(aspect);
	if (!Number.isFinite(ratio) || ratio <= 0.1 || ratio >= 10) {
		return null;
	}
	const width = DEFAULT_CARD_WIDTH;
	const height = Math.max(40, Math.min(2000, Math.round(width / ratio)));
	return { width, height };
};

export class GalleryViewStore {
	private state: GalleryViewState;

	constructor(initial: GalleryViewState | null) {
		this.state = {
			views: initial?.views ?? [],
			activeViewId: initial?.activeViewId ?? null
		};
	}

	reset(): void {
		this.state = { views: [], activeViewId: null };
	}

	load(next: GalleryViewState): void {
		const views = Array.isArray(next.views) ? next.views : [];
		this.state = {
			views: views.map((entry) => {
				const aspectSize = deriveSizeFromAspect((entry as { cardAspectRatio?: unknown }).cardAspectRatio);
				return {
					id: entry.id || createId(),
					name: typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name : 'Gallery',
					template: normalizeSlideViewConfig(entry.template ?? null),
					cardWidth: normalizeSize((entry as { cardWidth?: unknown }).cardWidth, aspectSize?.width ?? DEFAULT_CARD_WIDTH),
					cardHeight: normalizeSize((entry as { cardHeight?: unknown }).cardHeight, aspectSize?.height ?? DEFAULT_CARD_HEIGHT),
					groupField: typeof (entry as { groupField?: unknown }).groupField === 'string'
						? ((entry as { groupField: string }).groupField.trim() || null)
						: null
				};
			}),
			activeViewId: next.activeViewId ?? null
		};
		this.ensureActive();
	}

	resetWithConfig(config: SlideViewConfig, name = 'Gallery', cardSize?: { width?: number | null; height?: number | null }): void {
		const normalized = normalizeSlideViewConfig(config);
		const width = normalizeSize(cardSize?.width, DEFAULT_CARD_WIDTH);
		const height = normalizeSize(cardSize?.height, DEFAULT_CARD_HEIGHT);
		this.state = {
				views: [
					{
						id: createId(),
						name,
						template: normalized,
						cardWidth: width,
						cardHeight: height,
						groupField: null
					}
				],
				activeViewId: null
			};
			this.ensureActive();
	}

	getState(): GalleryViewState {
		return {
			views: this.state.views.map((entry) => ({
				id: entry.id,
				name: entry.name,
				template: entry.template,
				cardWidth: normalizeSize(entry.cardWidth, DEFAULT_CARD_WIDTH),
				cardHeight: normalizeSize(entry.cardHeight, DEFAULT_CARD_HEIGHT),
				groupField: entry.groupField ?? null
			})),
			activeViewId: this.state.activeViewId
		};
	}

	getActive(): GalleryViewDefinition | null {
		const activeId = this.state.activeViewId;
		if (!activeId) {
			return null;
		}
		return this.state.views.find((entry) => entry.id === activeId) ?? null;
	}

	ensureActive(): GalleryViewDefinition | null {
		if (!this.state.activeViewId && this.state.views.length > 0) {
			this.state.activeViewId = this.state.views[0].id;
		}
		return this.getActive();
	}

	setActive(id: string): GalleryViewDefinition | null {
		const target = this.state.views.find((entry) => entry.id === id);
		if (target) {
			this.state.activeViewId = id;
			return target;
		}
		return this.ensureActive();
	}

	createView(options: { name?: string; template: SlideViewConfig; setActive?: boolean }): GalleryViewDefinition {
		const name = this.composeUniqueName(options.name ?? 'Gallery');
		const def: GalleryViewDefinition = {
			id: createId(),
			name,
			template: normalizeSlideViewConfig(options.template),
			cardWidth: DEFAULT_CARD_WIDTH,
			cardHeight: DEFAULT_CARD_HEIGHT,
			groupField: null
		};
		this.state.views.push(def);
		if (options.setActive !== false) {
			this.state.activeViewId = def.id;
		} else {
			this.ensureActive();
		}
		return def;
	}

	updateTemplate(id: string, template: SlideViewConfig): GalleryViewDefinition | null {
		const target = this.state.views.find((entry) => entry.id === id);
		if (!target) {
			return null;
		}
		target.template = normalizeSlideViewConfig(template);
		return target;
	}

	updateName(id: string, name: string): GalleryViewDefinition | null {
		const target = this.state.views.find((entry) => entry.id === id);
		if (!target) {
			return null;
		}
		const trimmed = name.trim();
		target.name = trimmed.length > 0 ? trimmed : target.name;
		return target;
	}


	updateCardSize(id: string, size: { width: number; height: number }): GalleryViewDefinition | null {
		const target = this.state.views.find((entry) => entry.id === id);
		if (!target) {
			return null;
		}
		target.cardWidth = normalizeSize(size.width, DEFAULT_CARD_WIDTH);
		target.cardHeight = normalizeSize(size.height, DEFAULT_CARD_HEIGHT);
		return target;
	}

	duplicateView(id: string): GalleryViewDefinition | null {
		const target = this.state.views.find((entry) => entry.id === id);
		if (!target) {
			return null;
		}
		const duplicated = this.createView({
			name: this.composeUniqueName(target.name),
			template: target.template,
			setActive: true
		});
		this.updateCardSize(duplicated.id, {
			width: target.cardWidth ?? DEFAULT_CARD_WIDTH,
			height: target.cardHeight ?? DEFAULT_CARD_HEIGHT
		});
		duplicated.groupField = target.groupField ?? null;
		return duplicated;
	}

	deleteView(id: string): GalleryViewDefinition | null {
		if (this.state.views.length <= 1) {
			return this.ensureActive();
		}
		this.state.views = this.state.views.filter((entry) => entry.id !== id);
		if (this.state.activeViewId === id) {
			this.state.activeViewId = this.state.views[0]?.id ?? null;
		}
		return this.ensureActive();
	}

	setGroupField(id: string, field: string | null): GalleryViewDefinition | null {
		const target = this.state.views.find((entry) => entry.id === id);
		if (!target) {
			return null;
		}
		target.groupField = field && field.trim().length > 0 ? field.trim() : null;
		return target;
	}

	private composeUniqueName(baseName: string): string {
		const trimmed = baseName.trim();
		const base = trimmed.length > 0 ? trimmed : 'Gallery';
		const existing = new Set(this.state.views.map((entry) => entry.name.toLowerCase()));
		if (!existing.has(base.toLowerCase())) {
			return base;
		}
		for (let index = 2; index < 100; index += 1) {
			const candidate = `${base} ${index}`;
			if (!existing.has(candidate.toLowerCase())) {
				return candidate;
			}
		}
		return `${base} ${Date.now()}`;
	}
}
