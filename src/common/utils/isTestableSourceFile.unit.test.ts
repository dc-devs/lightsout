import { expect, test } from '@jest/globals';
import { isTestableSourceFile } from '@/common/utils/isTestableSourceFile';

test('isTestableSourceFile: the JS/TS family (including m/c module variants and mixed case) is testable', () => {
	expect(isTestableSourceFile('src/add.ts')).toBe(true);
	expect(isTestableSourceFile('src/App.tsx')).toBe(true);
	expect(isTestableSourceFile('src/util.js')).toBe(true);
	expect(isTestableSourceFile('src/Widget.jsx')).toBe(true);
	expect(isTestableSourceFile('src/esm.mjs')).toBe(true);
	expect(isTestableSourceFile('src/cjs.cjs')).toBe(true);
	expect(isTestableSourceFile('src/types.mts')).toBe(true);
	expect(isTestableSourceFile('src/legacy.cts')).toBe(true);
	expect(isTestableSourceFile('src/SHOUT.TS')).toBe(true);
});

test('isTestableSourceFile: unknown file types are not testable source', () => {
	expect(isTestableSourceFile('src/data.json')).toBe(false);
	expect(isTestableSourceFile('docs/readme.md')).toBe(false);
	expect(isTestableSourceFile('src/styles.css')).toBe(false);
	expect(isTestableSourceFile('script.py')).toBe(false);
	expect(isTestableSourceFile('Makefile')).toBe(false);
	expect(isTestableSourceFile('src/typescript-notes')).toBe(false);
});
