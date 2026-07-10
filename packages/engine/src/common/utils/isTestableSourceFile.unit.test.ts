import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTestableSourceFile } from './isTestableSourceFile';

test('isTestableSourceFile: the JS/TS family (including m/c module variants and mixed case) is testable', () => {
	assert.equal(isTestableSourceFile('src/add.ts'), true);
	assert.equal(isTestableSourceFile('src/App.tsx'), true);
	assert.equal(isTestableSourceFile('src/util.js'), true);
	assert.equal(isTestableSourceFile('src/Widget.jsx'), true);
	assert.equal(isTestableSourceFile('src/esm.mjs'), true);
	assert.equal(isTestableSourceFile('src/cjs.cjs'), true);
	assert.equal(isTestableSourceFile('src/types.mts'), true);
	assert.equal(isTestableSourceFile('src/legacy.cts'), true);
	assert.equal(isTestableSourceFile('src/SHOUT.TS'), true);
});

test('isTestableSourceFile: unknown file types are not testable source', () => {
	assert.equal(isTestableSourceFile('src/data.json'), false);
	assert.equal(isTestableSourceFile('docs/readme.md'), false);
	assert.equal(isTestableSourceFile('src/styles.css'), false);
	assert.equal(isTestableSourceFile('script.py'), false);
	assert.equal(isTestableSourceFile('Makefile'), false);
	assert.equal(isTestableSourceFile('src/typescript-notes'), false);
});
