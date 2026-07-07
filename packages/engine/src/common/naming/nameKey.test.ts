import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collapseCasing } from './collapseCasing';
import { nameKey } from './nameKey';
import { nameOf } from './nameOf';

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

test('collapseCasing: casing/separator variants collapse to one key', () => {
	assert.equal(collapseCasing('GetStarted'), collapseCasing('get-started'));
	assert.equal(collapseCasing('get_started'), collapseCasing('getStarted'));
	assert.notEqual(collapseCasing('getStarted'), collapseCasing('getStartedNow'));
});

test('nameOf: strips the source extension to the export name', () => {
	assert.equal(nameOf('src/a/getUser.ts'), 'getUser');
	assert.equal(nameOf('packages/x/src/Thing.tsx'), 'Thing');
	assert.equal(nameOf('index.mjs'), 'index');
});
