export const STATUS_BASELINE_VALUES = ['todo', 'inprogress', 'done', 'onhold', 'someday', 'canceled'] as const;

export type StatusBaselineValue = typeof STATUS_BASELINE_VALUES[number];

export function normalizeStatusValue(value: string): string {
	return value.trim().toLowerCase();
}

export function getStatusDisplayLabel(value: string): string {
	switch (normalizeStatusValue(value)) {
		case 'todo':
			return 'Todo';
		case 'inprogress':
		case 'in progress':
			return 'In Progress';
		case 'done':
			return 'Done';
		case 'onhold':
		case 'on hold':
			return 'On Hold';
		case 'someday':
			return 'Someday';
		case 'canceled':
		case 'cancelled':
			return 'Canceled';
		default:
			return value;
	}
}
