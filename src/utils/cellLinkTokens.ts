interface CellLinkToken {
	text: string;
	index: number;
	wikiInner?: string;
	markdownText?: string;
	markdownTarget?: string;
	bareUrl?: string;
}

// Cache closing delimiters so failed openers never rescan the same suffix.
export function* scanCellLinkTokens(value: string): Generator<CellLinkToken> {
	let nextBracket = -1;
	let nextParen = -1;
	const bareUrlPattern = /https?:\/\/[^\s<>"')]+/iy;
	for (let index = 0; index < value.length; index++) {
		if (value[index] === '[') {
			if (nextBracket <= index) {
				const found = value.indexOf(']', index + 1);
				nextBracket = found < 0 ? value.length : found;
			}
			if (nextBracket === value.length) continue;
			if (value[index + 1] === '[' && nextBracket > index + 2 && value[nextBracket + 1] === ']') {
				const innerOpener = value.indexOf('[', index + 2);
				if (innerOpener < 0 || innerOpener > nextBracket) {
					yield { text: value.slice(index, nextBracket + 2), index, wikiInner: value.slice(index + 2, nextBracket) };
					index = nextBracket + 1;
					continue;
				}
			}
			if (nextBracket > index + 1 && value[nextBracket + 1] === '(') {
				if (nextParen < nextBracket + 2) {
					const found = value.indexOf(')', nextBracket + 2);
					nextParen = found < 0 ? value.length : found;
				}
				if (nextParen < value.length && nextParen > nextBracket + 2) {
					yield {
						text: value.slice(index, nextParen + 1), index,
						markdownText: value.slice(index + 1, nextBracket),
						markdownTarget: value.slice(nextBracket + 2, nextParen)
					};
					index = nextParen;
				}
			}
		} else if (value[index] === 'h' || value[index] === 'H') {
			bareUrlPattern.lastIndex = index;
			const match = bareUrlPattern.exec(value);
			if (match) {
				yield { text: match[0], index, bareUrl: match[0] };
				index += match[0].length - 1;
			}
		}
	}
}
