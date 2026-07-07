import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameKey } from './nameKey';

test('nameKey: synonym verbs collapse to one key', () => {
	assert.equal(nameKey({ name: 'fetchUserData' }), nameKey({ name: 'getUserData' }));
	assert.equal(nameKey({ name: 'retrieveUserData' }), nameKey({ name: 'getUserData' }));
	assert.equal(nameKey({ name: 'makeThing' }), nameKey({ name: 'createThing' }));
});

test('nameKey: word order is normalized by sorting', () => {
	assert.equal(nameKey({ name: 'userDataGet' }), nameKey({ name: 'getUserData' }));
});

test('nameKey: the to/from guard keeps conversion opposites distinct', () => {
	assert.notEqual(nameKey({ name: 'hexToRgb' }), nameKey({ name: 'rgbToHex' }));
	assert.notEqual(nameKey({ name: 'dtoFromEntity' }), nameKey({ name: 'entityFromDto' }));
});
