import { KeyboardEventLike } from '../types';

export const normalizeKeyboardEvent = (event: unknown): KeyboardEventLike | null => {
	if (!event || typeof (event as { key?: unknown }).key !== 'string') {
		return null;
	}

	const original = event as {
		key: string;
		ctrlKey?: boolean;
		metaKey?: boolean;
		altKey?: boolean;
		shiftKey?: boolean;
		preventDefault?: () => void;
		stopPropagation?: () => void;
	};

	const preventDefault =
		typeof original.preventDefault === 'function'
			? original.preventDefault.bind(original)
			: undefined;
	const stopPropagation =
		typeof original.stopPropagation === 'function'
			? original.stopPropagation.bind(original)
			: undefined;

	return {
		key: original.key,
		ctrlKey: Boolean(original.ctrlKey),
		metaKey: Boolean(original.metaKey),
		altKey: Boolean(original.altKey),
		shiftKey: Boolean(original.shiftKey),
		preventDefault,
		stopPropagation
	};
};

export const isPrintableKey = (event: KeyboardEventLike): boolean => {
	return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
};
