export function deepClone<T>(value: T): T {
	if (value == null) {
		return value;
	}
	return JSON.parse(JSON.stringify(value)) as T;
}
