declare module 'monkey-around' {
	export function around<T extends object>(
		obj: T,
		overrides: {
			[K in keyof T]?: (next: T[K]) => T[K];
		}
	): () => void;
}
