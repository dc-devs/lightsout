import { describe, expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';

const setupOrderings = () => {
	const keysOneWay = { beta: 1, alpha: { delta: 4, charlie: 3 } };
	const keysOtherWay = { alpha: { charlie: 3, delta: 4 }, beta: 1 };
	const itemsOneWay = { items: ['a', 'b'] };
	const itemsOtherWay = { items: ['b', 'a'] };

	return { keysOneWay, keysOtherWay, itemsOneWay, itemsOtherWay };
};

const setupAbsences = () => {
	const withAbsent = { standards: 'abc', model: undefined, nested: { kept: 1, dropped: undefined } };
	const withoutTheKey = { standards: 'abc', nested: { kept: 1 } };
	const withNull = { standards: null, nested: { kept: 1 } };

	return { withAbsent, withoutTheKey, withNull };
};

describe('canonicalJson', () => {
	test('canonicalJson is stable across key order and preserves array order', () => {
		const { keysOneWay, keysOtherWay, itemsOneWay, itemsOtherWay } = setupOrderings();

		const encodedKeysOneWay = canonicalJson({ value: keysOneWay });
		const encodedKeysOtherWay = canonicalJson({ value: keysOtherWay });
		const encodedItemsOneWay = canonicalJson({ value: itemsOneWay });
		const encodedItemsOtherWay = canonicalJson({ value: itemsOtherWay });

		// two encodings that agree are still both wrong if the function returns a
		// constant, so the content is read back off the encoding as well
		expect(encodedKeysOneWay).toBe(encodedKeysOtherWay);
		expect(Object.keys(JSON.parse(encodedKeysOneWay))).toEqual(['alpha', 'beta']);
		expect(Object.keys(JSON.parse(encodedKeysOneWay).alpha)).toEqual(['charlie', 'delta']);
		expect(encodedItemsOneWay).not.toBe(encodedItemsOtherWay);
		expect(JSON.parse(encodedItemsOneWay)).toEqual({ items: ['a', 'b'] });
		expect(JSON.parse(encodedItemsOtherWay)).toEqual({ items: ['b', 'a'] });
	});

	test('an absent member drops out while an explicit null stays, at every depth', () => {
		const { withAbsent, withoutTheKey, withNull } = setupAbsences();

		const encodedWithAbsent = canonicalJson({ value: withAbsent });
		const encodedWithoutTheKey = canonicalJson({ value: withoutTheKey });
		const encodedWithNull = canonicalJson({ value: withNull });

		// a fingerprint field nobody set and a field the shape does not have are the
		// same measurement, so they must hash the same
		expect(encodedWithAbsent).toBe(encodedWithoutTheKey);
		expect(encodedWithAbsent).toBe('{"nested":{"kept":1},"standards":"abc"}');
		// null is a value somebody wrote, not a field nobody set, so it survives
		expect(encodedWithNull).toBe('{"nested":{"kept":1},"standards":null}');
		expect(encodedWithNull).not.toBe(encodedWithAbsent);
	});

	test('a value JSON cannot represent at all encodes as null rather than as nothing', () => {
		const encodedAbsent = canonicalJson({ value: undefined });
		const encodedNull = canonicalJson({ value: null });

		// `JSON.stringify(undefined)` is `undefined`, and a fingerprint hashed over
		// the empty string could not be told from one over an empty value
		expect(encodedAbsent).toBe('null');
		expect(encodedNull).toBe('null');
	});
});
