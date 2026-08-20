import { expect, test } from '@jest/globals';
import { nameKey } from '#src/common/naming/nameKey.ts';

test('nameKey: synonym verbs collapse to one key', () => {
	expect(nameKey({ name: 'fetchUserData' })).toBe(nameKey({ name: 'getUserData' }));
	expect(nameKey({ name: 'retrieveUserData' })).toBe(nameKey({ name: 'getUserData' }));
	expect(nameKey({ name: 'makeThing' })).toBe(nameKey({ name: 'createThing' }));
});

test('nameKey: word order is normalized by sorting', () => {
	expect(nameKey({ name: 'userDataGet' })).toBe(nameKey({ name: 'getUserData' }));
});

test('nameKey: the key is sorted lowercase tokens with the verb canonicalized', () => {
	expect(nameKey({ name: 'fetchUserData' })).toBe('data get user');
	expect(nameKey({ name: 'verify-facts' })).toBe('facts validate');
	expect(nameKey({ name: 'remove_stale.entry' })).toBe('delete entry stale');
});

test('nameKey: a to/from name keeps its source word order instead of sorting', () => {
	expect(nameKey({ name: 'hexToRgb' })).toBe('hex to rgb');
	expect(nameKey({ name: 'rgbToHex' })).toBe('rgb to hex');
});

test('nameKey: the to/from guard keeps conversion opposites distinct', () => {
	expect(nameKey({ name: 'hexToRgb' })).not.toBe(nameKey({ name: 'rgbToHex' }));
	expect(nameKey({ name: 'dtoFromEntity' })).not.toBe(nameKey({ name: 'entityFromDto' }));
});
