import { describe, expect, test } from '@jest/globals';
import { getManifestScriptKeys } from '#src/plan/common/utils/getManifestScriptKeys.ts';

describe('getManifestScriptKeys', () => {
	test('returns the script names a manifest declares, whatever their values hold', () => {
		const raw = JSON.stringify({ scripts: { test: 'jest', 'test:coverage': 'jest --coverage' } });

		expect(getManifestScriptKeys({ raw })).toStrictEqual(new Set(['test', 'test:coverage']));
	});

	test('an unreadable or scriptless manifest contributes no scripts, never a throw', () => {
		expect(getManifestScriptKeys({ raw: 'not json' })).toStrictEqual(new Set());
		expect(getManifestScriptKeys({ raw: JSON.stringify({ name: 'pkg' }) })).toStrictEqual(new Set());
		expect(getManifestScriptKeys({ raw: JSON.stringify({ scripts: 'nope' }) })).toStrictEqual(new Set());
	});
});
