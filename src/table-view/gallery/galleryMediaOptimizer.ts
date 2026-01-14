import { getLogger } from '../../utils/logger';

interface MediaSize {
	width: number;
	height: number;
}

interface CachedMedia {
	url: string;
	size: number;
}

const logger = getLogger('gallery:media-optimizer');
const cache = new Map<string, Promise<string | null>>();
const MIN_SIZE = 40;
const QUALITY = 0.82;
const DEFAULT_MIME = 'image/webp';
const FALLBACK_MIME = 'image/jpeg';
const SIZE_BUCKETS = [256, 320, 480, 640, 800, 1024, 1280];
const MAX_CACHE_BYTES = 200 * 1024 * 1024;
const DB_NAME = 'tlb-gallery-media-cache';
const DB_STORE = 'media';
const DB_VERSION = 1;

type MaybeDB = IDBDatabase | null;
let dbPromise: Promise<MaybeDB> | null = null;
const resolvedCache = new Map<string, CachedMedia | null>();
const entrySizes = new Map<string, number>();
const lruKeys = new Map<string, true>();
let totalBytes = 0;

const clampSize = (value: number): number => Math.max(MIN_SIZE, Math.round(value));

const normalizeSize = (size: MediaSize): MediaSize => {
	const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
	const targetWidth = clampSize(size.width);
	const bucket = SIZE_BUCKETS.find((entry) => entry >= targetWidth) ?? SIZE_BUCKETS[SIZE_BUCKETS.length - 1];
	const normalizedWidth = Math.round(bucket * dpr);
	const normalizedHeight = clampSize((normalizedWidth * size.height) / size.width);
	return { width: normalizedWidth, height: normalizedHeight };
};

const getDB = (): Promise<MaybeDB> => {
	if (dbPromise) {
		return dbPromise;
	}
	if (typeof indexedDB === 'undefined') {
		dbPromise = Promise.resolve(null);
		return dbPromise;
	}
	dbPromise = new Promise<MaybeDB>((resolve) => {
		try {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(DB_STORE)) {
					db.createObjectStore(DB_STORE);
				}
			};
			request.onsuccess = () => {
				resolve(request.result);
			};
			request.onerror = () => resolve(null);
			request.onblocked = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	return dbPromise;
};

const buildDbKey = (source: string, size: MediaSize): string => `${source}__${size.width}x${size.height}`;

const normalizeSourceKey = (source: string): string => {
	try {
		const url = new URL(source);
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		const [base] = source.split(/[?#]/);
		return base;
	}
};

const estimateSize = (blob: Blob | null, size: MediaSize): number => {
	if (blob && typeof blob.size === 'number') {
		return blob.size;
	}
	return size.width * size.height * 4;
};

const touchEntry = (key: string, size: number, url: string): void => {
	entrySizes.set(key, size);
	if (lruKeys.has(key)) {
		lruKeys.delete(key);
	}
	lruKeys.set(key, true);
	const previous = resolvedCache.get(key);
	if (previous?.url && previous.url !== url) {
		URL.revokeObjectURL(previous.url);
	}
	resolvedCache.set(key, { url, size });
	totalBytes += size - (previous?.size ?? 0);
	enforceLimit();
};

const deleteFromDB = async (key: string): Promise<void> => {
	const db = await getDB();
	if (!db) return;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(DB_STORE, 'readwrite');
			const store = tx.objectStore(DB_STORE);
			store.delete(key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => resolve();
			tx.onabort = () => resolve();
		} catch {
			resolve();
		}
	});
};

const enforceLimit = (): void => {
	while (totalBytes > MAX_CACHE_BYTES && lruKeys.size > 0) {
		const oldest = lruKeys.keys().next().value as string | undefined;
		if (!oldest) break;
		lruKeys.delete(oldest);
		const size = entrySizes.get(oldest) ?? 0;
		entrySizes.delete(oldest);
		totalBytes = Math.max(0, totalBytes - size);
		const entry = resolvedCache.get(oldest);
		if (entry?.url) {
			URL.revokeObjectURL(entry.url);
		}
		resolvedCache.delete(oldest);
		void deleteFromDB(oldest);
	}
};

const readFromDB = async (key: string, sizeHint: MediaSize): Promise<CachedMedia | null> => {
	const db = await getDB();
	if (!db) return null;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(DB_STORE, 'readonly');
			const store = tx.objectStore(DB_STORE);
			const req = store.get(key);
			req.onsuccess = () => {
				const blob = req.result as Blob | undefined;
				if (!blob) {
					resolve(null);
					return;
				}
				const url = URL.createObjectURL(blob);
				const size = estimateSize(blob, sizeHint);
				resolve({ url, size });
			};
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
};

const writeToDB = async (key: string, blob: Blob): Promise<void> => {
	const db = await getDB();
	if (!db) return;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(DB_STORE, 'readwrite');
			const store = tx.objectStore(DB_STORE);
			store.put(blob, key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => resolve();
			tx.onabort = () => resolve();
		} catch {
			resolve();
		}
	});
};

const computeCoverRect = (sourceW: number, sourceH: number, targetW: number, targetH: number) => {
	const sourceRatio = sourceW / sourceH;
	const targetRatio = targetW / targetH;
	if (sourceRatio > targetRatio) {
		const newW = targetRatio * sourceH;
		const sx = (sourceW - newW) / 2;
		return { sx, sy: 0, sw: newW, sh: sourceH };
	}
	const newH = sourceW / targetRatio;
	const sy = (sourceH - newH) / 2;
	return { sx: 0, sy, sw: sourceW, sh: newH };
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const img = new Image();
		try {
			img.crossOrigin = 'anonymous';
		} catch {
			// ignore crossOrigin errors for local schemes
		}
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('image load failed'));
		img.src = src;
	});

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
	new Promise((resolve) => {
		const tryMime = (mime: string, quality?: number) =>
			canvas.toBlob(
				(blob) => {
					resolve(blob);
				},
				mime,
				quality
			);
		tryMime(DEFAULT_MIME, QUALITY);
	});

async function buildResizedObjectUrl(source: string, size: MediaSize): Promise<{ url: string; blob: Blob } | null> {
	try {
		const img = await loadImage(source);
		if (!img.naturalWidth || !img.naturalHeight) {
			return null;
		}
		const targetW = clampSize(size.width);
		const targetH = clampSize(size.height);
		if (img.naturalWidth <= targetW && img.naturalHeight <= targetH) {
			return null;
		}
		const canvas = document.createElement('canvas');
		canvas.width = targetW;
		canvas.height = targetH;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return null;
		}
		const rect = computeCoverRect(img.naturalWidth, img.naturalHeight, targetW, targetH);
		ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, targetW, targetH);
		const blob =
			(await toBlob(canvas)) ??
			(await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, FALLBACK_MIME, QUALITY)));
		if (!blob) {
			return null;
		}
		return { url: URL.createObjectURL(blob), blob };
	} catch (error) {
		logger.debug('optimize image failed', { source, error });
		return null;
	}
}

async function getOptimizedUrl(source: string, size: MediaSize): Promise<string | null> {
	const normalized = normalizeSize(size);
	const sourceKey = normalizeSourceKey(source);
	const key = buildDbKey(sourceKey, normalized);
	const existing = cache.get(key);
	if (existing) {
		return existing;
	}
	const promise = (async () => {
		const cached = await readFromDB(key, normalized);
		if (cached) {
			touchEntry(key, cached.size, cached.url);
			return cached.url;
		}
		const resized = await buildResizedObjectUrl(source, normalized);
		if (resized) {
			void writeToDB(key, resized.blob);
			touchEntry(key, estimateSize(resized.blob, normalized), resized.url);
			return resized.url;
		}
		resolvedCache.set(key, null);
		return null;
	})();
	cache.set(key, promise);
	return promise;
}

const setImageAttributes = (img: HTMLImageElement, size: MediaSize): void => {
	if (img.loading !== 'lazy') {
		img.loading = 'lazy';
	}
	if (img.decoding !== 'async') {
		img.decoding = 'async';
	}
	if ('fetchPriority' in img) {
		(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
	}
	const normalized = normalizeSize(size);
	const targetW = clampSize(normalized.width);
	const targetH = clampSize(normalized.height);
	img.width = targetW;
	img.height = targetH;
	img.setAttribute('width', String(targetW));
	img.setAttribute('height', String(targetH));
};

export function optimizeGalleryMediaElements(
	container: HTMLElement,
	size: MediaSize,
	options?: { isFirstBatch?: boolean }
): Promise<void> {
	const normalized = normalizeSize(size);
	const targetW = clampSize(normalized.width);
	const targetH = clampSize(normalized.height);
	if (!Number.isFinite(targetW) || !Number.isFinite(targetH)) {
		return Promise.resolve();
	}
	const images = container.querySelectorAll<HTMLImageElement>('img');
	const promises: Array<Promise<void>> = [];
	images.forEach((img) => {
		img.classList.add('tlb-gallery-media');
		const original = img.dataset.tlbOriginalSrc ?? img.currentSrc ?? img.src;
		if (!original) return;
		const sourceKey = normalizeSourceKey(original);
		const key = buildDbKey(sourceKey, { width: targetW, height: targetH });
		if (img.dataset.tlbOptimizedKey === key) {
			return;
		}
		img.dataset.tlbOptimizedKey = key;
		img.dataset.tlbOriginalSrc = original;
		setImageAttributes(img, { width: targetW, height: targetH });
		const cachedEntry = resolvedCache.get(key);
		const shouldForceEager = options?.isFirstBatch || Boolean(cachedEntry?.url);
		if (shouldForceEager) {
			img.loading = 'eager';
		}
		if (cachedEntry?.url) {
			img.src = cachedEntry.url;
			touchEntry(key, cachedEntry.size, cachedEntry.url);
			return;
		}
		const task = getOptimizedUrl(original, { width: targetW, height: targetH }).then((optimized) => {
			if (!optimized || !img.isConnected) return;
			if (img.dataset.tlbOptimizedKey !== key) return;
			img.src = optimized;
		});
		promises.push(task);
	});

	const videos = container.querySelectorAll<HTMLVideoElement>('video');
	videos.forEach((video) => {
		video.classList.add('tlb-gallery-media');
		if (!video.preload || video.preload === 'auto') {
			video.preload = 'metadata';
		}
	});

	if (promises.length === 0) {
		return Promise.resolve();
	}
	return Promise.allSettled(promises).then(() => undefined);
}
