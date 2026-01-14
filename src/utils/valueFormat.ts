export function formatUnknownValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return String(value);
	}
	if (typeof value === 'symbol') {
		return value.toString();
	}
	if (typeof value === 'function') {
		return value.name || 'function';
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	try {
		const json = JSON.stringify(value);
		return json ?? '';
	} catch {
		return '';
	}
}
