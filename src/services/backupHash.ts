const FNV32_OFFSET_BASIS = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

interface SubtleCryptoLike {
	digest: (algorithm: string, data: ArrayBuffer | Uint8Array) => Promise<ArrayBuffer>;
}

interface CryptoLike {
	subtle?: SubtleCryptoLike;
}

export async function computeBackupHash(data: Uint8Array): Promise<string> {
	const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto;
	if (cryptoApi?.subtle) {
		const digest = await cryptoApi.subtle.digest('SHA-256', data);
		return arrayBufferToHex(digest);
	}
	return fallbackHash(data);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let result = '';
	for (let index = 0; index < bytes.length; index++) {
		result += bytes[index].toString(16).padStart(2, '0');
	}
	return result;
}

function fallbackHash(data: Uint8Array): string {
	let hashA = FNV32_OFFSET_BASIS;
	let hashB = FNV32_OFFSET_BASIS;
	for (let index = 0; index < data.length; index++) {
		const value = data[index];
		hashA = Math.imul(hashA ^ value, FNV32_PRIME) >>> 0;
		hashB = Math.imul(hashB ^ ((value + index) & 0xff), FNV32_PRIME) >>> 0;
	}
	return hashA.toString(16).padStart(8, '0') + hashB.toString(16).padStart(8, '0');
}
