export type StatusValue = 'todo' | 'done' | 'inprogress' | 'onhold' | 'canceled';

export const STATUS_VALUES: StatusValue[] = ['todo', 'done', 'inprogress', 'onhold', 'canceled'];

export const STATUS_ICON_MAP: Record<StatusValue, string> = {
	todo: '',
	done: '✓',
	inprogress: '─',
	onhold: '‖',
	canceled: '✕'
};

export const STATUS_LABEL_MAP: Record<StatusValue, string> = {
	todo: '待办',
	done: '已完成',
	inprogress: '进行中',
	onhold: '已搁置',
	canceled: '已放弃'
};

const STATUS_ALIASES: Record<string, StatusValue> = {
	todo: 'todo',
	'to-do': 'todo',
	'to_do': 'todo',
	'待办': 'todo',
	'☐': 'todo',
	done: 'done',
	completed: 'done',
	'已完成': 'done',
	'☑': 'done',
	'✓': 'done',
	inprogress: 'inprogress',
	'in-progress': 'inprogress',
	'in_progress': 'inprogress',
	doing: 'inprogress',
	'进行中': 'inprogress',
	'⊟': 'inprogress',
	'─': 'inprogress',
	'-': 'inprogress',
	onhold: 'onhold',
	'on-hold': 'onhold',
	'on_hold': 'onhold',
	hold: 'onhold',
	paused: 'onhold',
	'已搁置': 'onhold',
	'⏸': 'onhold',
	'‖': 'onhold',
	canceled: 'canceled',
	cancelled: 'canceled',
	dropped: 'canceled',
	'已放弃': 'canceled',
	'☒': 'canceled',
	'✕': 'canceled',
	'×': 'canceled'
};

export function normalizeStatus(value: unknown): StatusValue {
	if (typeof value !== 'string') {
		return 'todo';
	}

	const key = value.trim().toLowerCase();
	if (!key) {
		return 'todo';
	}

	return STATUS_ALIASES[key] ?? (STATUS_ALIASES[key.replace(/\s+/g, '-')] ?? 'todo');
}

export function isCompletedStatus(status: StatusValue): boolean {
	return status === 'done' || status === 'canceled';
}

export function getStatusIcon(status: StatusValue): string {
	return STATUS_ICON_MAP[status];
}

export function getStatusLabel(status: StatusValue): string {
	return STATUS_LABEL_MAP[status];
}

export function getNextToggleStatus(current: StatusValue): StatusValue {
	if (current === 'todo') {
		return 'done';
	}

	if (current === 'done') {
		return 'todo';
	}

	return 'done';
}
