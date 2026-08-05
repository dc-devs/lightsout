import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameOf } from '@/common/naming/nameOf';

test('nameOf: strips the source extension to the export name', () => {
	assert.equal(nameOf('src/a/getUser.ts'), 'getUser');
	assert.equal(nameOf('packages/x/src/Thing.tsx'), 'Thing');
	assert.equal(nameOf('index.mjs'), 'index');
});

test('nameOf: every javascript/typescript extension flavour is stripped', () => {
	assert.equal(nameOf('src/a/legacy.cjs'), 'legacy');
	assert.equal(nameOf('src/a/Widget.jsx'), 'Widget');
	assert.equal(nameOf('src/a/plain.js'), 'plain');
	assert.equal(nameOf('src/a/schema.mts'), 'schema');
	assert.equal(nameOf('src/a/schema.cts'), 'schema');
});

test('nameOf: only the trailing source extension goes — dotted names and other file types survive', () => {
	assert.equal(nameOf('src/a/getUser.unit.test.ts'), 'getUser.unit.test', 'the qualifier stays part of the name');
	assert.equal(nameOf('src/b/session-response.model.ts'), 'session-response.model');
	assert.equal(nameOf('src/a/theme.css'), 'theme.css', 'a non-source extension is not an extension to strip');
	assert.equal(nameOf('src/a/Button'), 'Button');
});
