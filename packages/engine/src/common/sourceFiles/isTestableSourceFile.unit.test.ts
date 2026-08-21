import { expect, test } from '@jest/globals';
import { isTestableSourceFile } from '#src/common/sourceFiles/isTestableSourceFile.ts';

test.each([
	{ path: 'src/add.ts' },
	{ path: 'src/App.tsx' },
	{ path: 'src/util.js' },
	{ path: 'src/Widget.jsx' },
	{ path: 'src/esm.mjs' },
	{ path: 'src/cjs.cjs' },
	{ path: 'src/types.mts' },
	{ path: 'src/legacy.cts' },
	{ path: 'src/SHOUT.TS' },
])('isTestableSourceFile: $path is in the JS/TS family, so it is testable', ({ path }) => {
	const testable = isTestableSourceFile({ path });

	expect(testable).toBe(true);
});

test.each([
	{ path: 'src/data.json' },
	{ path: 'docs/readme.md' },
	{ path: 'src/styles.css' },
	{ path: 'script.py' },
	{ path: 'Makefile' },
	{ path: 'src/typescript-notes' },
])('isTestableSourceFile: $path is an unknown file type, so it is not testable source', ({ path }) => {
	const testable = isTestableSourceFile({ path });

	expect(testable).toBe(false);
});
