const sanitizeLaneValues = (value: unknown): string[] => {
	if (!Array.isArray(value)) {
		return [];
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const label = typeof entry === 'string' ? entry.trim() : '';
		if (!label) {
			continue;
		}
		const normalized = label.toLowerCase();
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		result.push(label);
	}
	return result;
};

export function sanitizeLanePresets(value: unknown): string[] {
	return sanitizeLaneValues(value);
}

export function sanitizeLaneOrdering(value: unknown): string[] {
	return sanitizeLaneValues(value);
}
