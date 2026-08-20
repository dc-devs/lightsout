import { expect, test } from '@jest/globals';
import { nameOf } from '#src/common/naming/nameOf.ts';

test('nameOf: strips the source extension to the export name', () => {
	expect(nameOf('src/a/getUser.ts')).toBe('getUser');
	expect(nameOf('packages/x/src/Thing.tsx')).toBe('Thing');
	expect(nameOf('index.mjs')).toBe('index');
});

test('nameOf: every javascript/typescript extension flavour is stripped', () => {
	expect(nameOf('src/a/legacy.cjs')).toBe('legacy');
	expect(nameOf('src/a/Widget.jsx')).toBe('Widget');
	expect(nameOf('src/a/plain.js')).toBe('plain');
	expect(nameOf('src/a/schema.mts')).toBe('schema');
	expect(nameOf('src/a/schema.cts')).toBe('schema');
});

test('nameOf: only the trailing source extension goes — dotted names and other file types survive', () => {
	// the qualifier stays part of the name
	expect(nameOf('src/a/getUser.unit.test.ts')).toBe('getUser.unit.test');
	expect(nameOf('src/b/session-response.model.ts')).toBe('session-response.model');
	// a non-source extension is not an extension to strip
	expect(nameOf('src/a/theme.css')).toBe('theme.css');
	expect(nameOf('src/a/Button')).toBe('Button');
});
