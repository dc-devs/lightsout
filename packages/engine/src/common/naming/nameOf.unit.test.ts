import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameOf } from './nameOf';

test('nameOf: strips the source extension to the export name', () => {
	assert.equal(nameOf('src/a/getUser.ts'), 'getUser');
	assert.equal(nameOf('packages/x/src/Thing.tsx'), 'Thing');
	assert.equal(nameOf('index.mjs'), 'index');
});
