import { describe, expect, test } from '@jest/globals';
import { getComparableTokens } from '#src/plan/common/naming/getComparableTokens.ts';

/** One line per span shape the reduction has to decide, in the order the map's keys are asserted in. */
const setupLines = () => {
	const repoRelativePath = 'packages/engine/src/plan/parsePlan.ts';
	const aliasPath = '#src/plan/parsePlan.ts';
	const lines = [
		`- \`${repoRelativePath}\` gains the map.`,
		`- \`${aliasPath}\` is the same file spelled through the package alias.`,
		'- `generatedPlanRegions` is exported.',
		'- `None` — final phase.',
		'- `provenance.createdBy` is a dotted member span.',
		'- The phase hands forward parsePlan and generatedPlanRegions, in prose with no span.',
	];

	return { lines, spellings: [repoRelativePath, aliasPath] };
};

describe('getComparableTokens', () => {
	test('getComparableTokens: a path reduces to its basename, an identifier stays verbatim, and sentinels and prose are skipped', () => {
		const { lines, spellings } = setupLines();

		const tokens = getComparableTokens({ lines });

		// the two path spellings collapse onto one key, and the sentinel, the dotted
		// member span and the unbackticked prose contribute no key at all
		expect([...tokens.keys()]).toStrictEqual(['parsePlan.ts', 'generatedPlanRegions']);
		expect(tokens.get('generatedPlanRegions')).toBe('generatedPlanRegions');
		expect(spellings).toContain(tokens.get('parsePlan.ts'));
	});
});
