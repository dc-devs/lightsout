import { describe, expect, test } from '@jest/globals';
import { getDefaultPackBundle } from '#src/lightsout/common/utils/getDefaultPackBundle.ts';

// The committed bundle is the subject: parsing it against `StandardsPackBundle`
// is what catches `assets/default-pack.json` gone stale after a contract change.

describe('getDefaultPackBundle', () => {
	test('parses the committed pack against the contract the engine reads it to', () => {
		const bundle = getDefaultPackBundle();

		expect(bundle.name).toBe('lightsout-defaults');
	});

	test('is the authored pack rather than the shipped copy, which is the whole reason the app carries it', () => {
		const bundle = getDefaultPackBundle();

		expect({ built: bundle.built, isDefault: bundle.isDefault }).toStrictEqual({ built: false, isDefault: true });
	});

	test('still has the fixtures a rule page exists to show', () => {
		const bundle = getDefaultPackBundle();

		expect(bundle.rules.some((rule) => rule.fixtures.length > 0)).toBe(true);
	});

	test('carries no machine’s path, since the file is committed and compared byte for byte', () => {
		const bundle = getDefaultPackBundle();

		expect({ rootPath: bundle.rootPath, path: bundle.path }).toStrictEqual({
			rootPath: 'packages/standards-typescript',
			path: 'packages/standards-typescript',
		});
	});

	test('parses once and hands the same object back', () => {
		expect(getDefaultPackBundle()).toBe(getDefaultPackBundle());
	});
});
