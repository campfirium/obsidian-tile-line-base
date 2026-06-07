import { t, type TranslationKey } from '../i18n';
import { formatUnknownValue } from './valueFormat';

export type TaskStatus = 'todo' | 'done' | 'inprogress' | 'onhold' | 'someday' | 'canceled';

export const ALL_TASK_STATUSES: readonly TaskStatus[] = ['todo', 'done', 'inprogress', 'onhold', 'someday', 'canceled'] as const;

export function normalizeStatus(value: unknown): TaskStatus {
	const str = formatUnknownValue(value ?? 'todo').toLowerCase().trim();
	const normalized = str.replace(/[\s_/-]+/g, '');

	if (normalized === 'done' || normalized === 'completed') {
		return 'done';
	}

	if (normalized === 'inprogress' || normalized === 'doing') {
		return 'inprogress';
	}

	if (normalized === 'onhold' || normalized === 'hold' || normalized === 'paused') {
		return 'onhold';
	}

	if (
		normalized === 'someday' ||
		normalized === 'later' ||
		normalized === 'maybe' ||
		normalized === 'somedaymaybe'
	) {
		return 'someday';
	}

	if (normalized === 'canceled' || normalized === 'cancelled' || normalized === 'dropped') {
		return 'canceled';
	}

	return 'todo';
}

export function getStatusIcon(status: TaskStatus): string {
	const icons: Record<TaskStatus, string> = {
		todo: 'square',
		done: 'check-square',
		inprogress: 'loader-circle',
		onhold: 'pause-circle',
		someday: 'circle-dashed',
		canceled: 'x-square'
	};
	return icons[status] ?? icons.todo;
}

const STATUS_LABEL_KEYS: Record<TaskStatus, TranslationKey> = {
	todo: 'statusCell.labels.todo',
	done: 'statusCell.labels.done',
	inprogress: 'statusCell.labels.inprogress',
	onhold: 'statusCell.labels.onhold',
	someday: 'statusCell.labels.someday',
	canceled: 'statusCell.labels.canceled'
};

export function getStatusLabel(status: TaskStatus): string {
	const key = STATUS_LABEL_KEYS[status] ?? STATUS_LABEL_KEYS.todo;
	return t(key);
}
