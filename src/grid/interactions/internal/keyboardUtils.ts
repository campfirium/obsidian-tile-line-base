import { KeyboardEventLike } from '../types';

type KeyboardEventCandidate = {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	preventDefault?: () => void;
	stopPropagation?: () => void;
};

function hasKeyboardKey(event: unknown): event is KeyboardEventCandidate {
	return typeof event === 'object'
		&& event !== null
		&& typeof (event as { key?: unknown }).key === 'string';
}

export const normalizeKeyboardEvent = (event: unknown): KeyboardEventLike | null => {
	if (!hasKeyboardKey(event)) {
		return null;
	}

	const preventDefault =
		typeof event.preventDefault === 'function'
			? () => event.preventDefault?.()
			: undefined;
	const stopPropagation =
		typeof event.stopPropagation === 'function'
			? () => event.stopPropagation?.()
			: undefined;

	return {
		key: event.key,
		ctrlKey: Boolean(event.ctrlKey),
		metaKey: Boolean(event.metaKey),
		altKey: Boolean(event.altKey),
		shiftKey: Boolean(event.shiftKey),
		preventDefault,
		stopPropagation
	};
};

export const isPrintableKey = (event: KeyboardEventLike): boolean => {
	return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
};
