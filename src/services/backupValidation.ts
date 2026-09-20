// Backup identifiers are generated locally; imported indexes must use the same format.
export function isSafeBackupEntryId(value: string): boolean {
	return /^\d{8}-\d{6}-\d{3}(?:-\d{2,})?$/.test(value) && isSafeBackupRelativePath(value);
}

export function isSafeBackupRelativePath(value: string): boolean {
	for (const character of value) {
		if (character.charCodeAt(0) < 32) return false;
	}
	return value.length > 0 && !/[\\:]/.test(value) &&
		value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}
