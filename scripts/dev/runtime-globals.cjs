Object.defineProperty(globalThis, '__LOG_PROD__', {
	value: false,
	writable: false,
	configurable: true
});

if (typeof globalThis.window === 'undefined') {
	Object.defineProperty(globalThis, 'window', {
		value: globalThis,
		writable: false,
		configurable: true
	});
}
