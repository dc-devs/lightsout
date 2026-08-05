import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameKey } from '@/common/naming/nameKey';

test('nameKey: synonym verbs collapse to one key', () => {
	assert.equal(nameKey({ name: 'fetchUserData' }), nameKey({ name: 'getUserData' }));
	assert.equal(nameKey({ name: 'retrieveUserData' }), nameKey({ name: 'getUserData' }));
	assert.equal(nameKey({ name: 'makeThing' }), nameKey({ name: 'createThing' }));
});

test('nameKey: word order is normalized by sorting', () => {
	assert.equal(nameKey({ name: 'userDataGet' }), nameKey({ name: 'getUserData' }));
});

test('nameKey: the key is sorted lowercase tokens with the verb canonicalized', () => {
	assert.equal(nameKey({ name: 'fetchUserData' }), 'data get user');
	assert.equal(nameKey({ name: 'verify-facts' }), 'facts validate');
	assert.equal(nameKey({ name: 'remove_stale.entry' }), 'delete entry stale');
});

test('nameKey: a to/from name keeps its source word order instead of sorting', () => {
	assert.equal(nameKey({ name: 'hexToRgb' }), 'hex to rgb');
	assert.equal(nameKey({ name: 'rgbToHex' }), 'rgb to hex');
});

test('nameKey: the to/from guard keeps conversion opposites distinct', () => {
	assert.notEqual(nameKey({ name: 'hexToRgb' }), nameKey({ name: 'rgbToHex' }));
	assert.notEqual(nameKey({ name: 'dtoFromEntity' }), nameKey({ name: 'entityFromDto' }));
});
