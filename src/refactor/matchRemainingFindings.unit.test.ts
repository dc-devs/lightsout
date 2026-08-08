import { expect, test } from '@jest/globals';
import type { StandardsFinding } from '@/contracts';
import { matchRemainingFindings } from '@/refactor';

const finding = ({ rule, siteKey, paths }: { rule: StandardsFinding['rule']; siteKey: string; paths: string[] }): StandardsFinding => ({
	rule,
	severity: 'blocking',
	siteKey,
	files: paths.map((path) => ({ path })),
	detail: 'stub',
});

test('site keys match by id; a vanished id is resolved', () => {
	const frozen = [finding({ rule: 'multi-export', siteKey: 'multi-export:src/a.ts', paths: ['src/a.ts'] })];

	expect(matchRemainingFindings({ frozen, live: frozen })).toStrictEqual(['multi-export:src/a.ts']);
	expect(matchRemainingFindings({ frozen, live: [] })).toStrictEqual([]);
});

test('a clone whose lines shifted keeps the same key, so it is still remaining', () => {
	// Both sides list the same pair in a different order — buildSiteKey sorts, so
	// the identity is the same string and no per-rule special case is needed.
	const frozen = [finding({ rule: 'clone', siteKey: 'clone:src/a.ts|src/b.ts', paths: ['src/b.ts', 'src/a.ts'] })];
	const live = [finding({ rule: 'clone', siteKey: 'clone:src/a.ts|src/b.ts', paths: ['src/a.ts', 'src/b.ts'] })];

	// line drift must not read as resolved — that is a gate escape
	expect(matchRemainingFindings({ frozen, live })).toStrictEqual(['clone:src/a.ts|src/b.ts']);
});

test('a live finding of another rule on the same files never keeps a frozen clone alive', () => {
	const frozen = [finding({ rule: 'clone', siteKey: 'clone:src/a.ts|src/b.ts', paths: ['src/b.ts', 'src/a.ts'] })];
	const live = [finding({ rule: 'multi-export', siteKey: 'multi-export:src/a.ts', paths: ['src/a.ts', 'src/b.ts'] })];

	// the rule is part of the key, so unrelated debt in the same files can never
	// report the duplication as unresolved forever
	expect(matchRemainingFindings({ frozen, live })).toStrictEqual([]);
});

test('a clone is resolved once no live clone shares its file pair', () => {
	const frozen = [finding({ rule: 'clone', siteKey: 'clone:src/a.ts|src/b.ts', paths: ['src/b.ts', 'src/a.ts'] })];
	const live = [finding({ rule: 'clone', siteKey: 'clone:src/c.ts|src/d.ts', paths: ['src/c.ts', 'src/d.ts'] })];

	expect(matchRemainingFindings({ frozen, live })).toStrictEqual([]);
});
