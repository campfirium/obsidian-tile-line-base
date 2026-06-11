import { strict as assert } from 'assert';
import { resolveDirectImage, sanitizeSlideImageMarkdown } from '../../src/table-view/slide/SlideContentResolver';

const pngDataUri = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
const svgDataUri = `data:image/svg+xml;base64,${Buffer.from('<svg></svg>').toString('base64')}`;
const oversizedDataUri = `data:image/png;base64,${'a'.repeat(1024 * 1024)}`;

assert.equal(resolveDirectImage(pngDataUri), `![](${pngDataUri})`);
assert.equal(resolveDirectImage(`![ok](${pngDataUri})`), `![ok](${pngDataUri})`);
assert.equal(resolveDirectImage(svgDataUri), null);
assert.equal(resolveDirectImage(`![bad](${svgDataUri})`), null);
assert.equal(resolveDirectImage(oversizedDataUri), null);

assert.equal(resolveDirectImage('https://example.com/image.png'), '![](https://example.com/image.png)');
assert.equal(resolveDirectImage('![remote](https://example.com/render?id=1)'), '![remote](https://example.com/render?id=1)');
assert.equal(resolveDirectImage('ftp://example.com/image.png'), null);
assert.equal(resolveDirectImage('![bad](file:///tmp/image.png)'), null);
assert.equal(resolveDirectImage('![bad](javascript:alert(1))'), null);

assert.equal(resolveDirectImage('[[Assets/photo.png]]'), '![[Assets/photo.png]]');
assert.equal(resolveDirectImage('![[Assets/photo.png|cover]]'), '![[Assets/photo.png|cover]]');
assert.equal(resolveDirectImage('Assets/photo.png?version=1'), '![[Assets/photo.png?version=1]]');

assert.equal(sanitizeSlideImageMarkdown(`Before ![bad](${svgDataUri}) after`), 'Before bad after');
assert.equal(
	sanitizeSlideImageMarkdown(`Before ![ok](https://example.com/render?id=1) and ![[Assets/photo.png|cover]]`),
	'Before ![ok](https://example.com/render?id=1) and ![[Assets/photo.png|cover]]'
);

console.log('slide image URI checks passed');
