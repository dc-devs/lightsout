import { describe, expect, test } from '@jest/globals';
import type { PlanFacts } from '@/contracts';
import { estimatePlanScope } from '@/plan/estimatePlanScope';

/** Facts whose one area touches the given modify and mirror paths. */
const factsTouching = ({ modify = [], mirror = [] }: { modify?: string[]; mirror?: string[] }): PlanFacts => ({
	request: 'do a thing',
	areas: [
		{
			area: 'core',
			affectedPackages: [],
			filesToModify: modify.map((path) => ({ path, role: 'touched' })),
			patternsToMirror: mirror.map((path) => ({ path, takeaway: 'shape' })),
			integrationPoints: [],
			scripts: [],
			namingConvention: 'camelCase',
		},
	],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
	verifiedAt: '2026-01-01T00:00:00.000Z',
});

/** `count` distinct repo-relative paths. */
const paths = (count: number) => Array.from({ length: count }, (_, index) => `src/mod${index}.ts`);

describe('estimatePlanScope', () => {
	test('facts touching more paths than the phased threshold estimate the overview variant', () => {
		expect(estimatePlanScope({ facts: factsTouching({ modify: paths(41) }) })).toBe('overview');
	});

	test('facts at the phased threshold stay single — the buffer under the executor guardrail is the line', () => {
		expect(estimatePlanScope({ facts: factsTouching({ modify: paths(40) }) })).toBe('single');
	});

	test('a path both modified and mirrored counts once', () => {
		// 41 entries over 40 distinct paths stay under the threshold
		expect(estimatePlanScope({ facts: factsTouching({ modify: paths(40), mirror: ['src/mod0.ts'] }) })).toBe('single');
	});
});
