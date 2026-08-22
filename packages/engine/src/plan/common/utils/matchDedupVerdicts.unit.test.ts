import { describe, expect, test } from '@jest/globals';
import { DedupResolution, type DedupVerdict } from '#src/contracts/index.ts';
import type { PriorArtCandidate } from '#src/plan/common/types/PriorArtCandidate.ts';
import { matchDedupVerdicts } from '#src/plan/common/utils/matchDedupVerdicts.ts';

const candidate = (overrides: Partial<PriorArtCandidate> = {}): PriorArtCandidate => ({
	plannedSymbol: 'formatDate',
	plannedPath: 'src/plan/common/utils/formatDate.ts',
	phase: 'phase2-cross-phase-checks.md',
	collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }],
	...overrides,
});

const verdict = (overrides: Partial<DedupVerdict> = {}): DedupVerdict => ({
	plannedSymbol: 'formatDate',
	isDuplicate: true,
	recommendation: DedupResolution.Reuse,
	rationale: 'the planned symbol restates an existing utility',
	migrateCallers: [],
	...overrides,
});

describe('matchDedupVerdicts', () => {
	test('pairs a confirmed duplicate with the collision the engine detected', () => {
		const findings = matchDedupVerdicts({ candidates: [candidate()], verdicts: [verdict()] });

		expect(findings).toStrictEqual([
			{
				plannedSymbol: 'formatDate',
				plannedPath: 'src/plan/common/utils/formatDate.ts',
				phase: 'phase2-cross-phase-checks.md',
				collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }],
				recommendation: DedupResolution.Reuse,
				rationale: 'the planned symbol restates an existing utility',
				suggestedLocation: undefined,
				migrateCallers: [],
			},
		]);
	});

	test('drops a collision the judge ruled is not really a duplicate', () => {
		const findings = matchDedupVerdicts({ candidates: [candidate()], verdicts: [verdict({ isDuplicate: false })] });

		// a name match is not a duplicate — that ruling is the whole point of the judge
		expect(findings).toStrictEqual([]);
	});

	test('drops a candidate the judge never ruled on, because silence is not confirmation', () => {
		const findings = matchDedupVerdicts({ candidates: [candidate()], verdicts: [] });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a verdict about a symbol nobody detected', () => {
		// without a detected candidate there are no real collidesWith locations to
		// send a human to read
		const findings = matchDedupVerdicts({ candidates: [], verdicts: [verdict({ plannedSymbol: 'invented' })] });

		expect(findings).toStrictEqual([]);
	});

	test('matches by symbol rather than position, so the judge may answer out of order', () => {
		const candidates = [candidate({ plannedSymbol: 'first' }), candidate({ plannedSymbol: 'second' })];
		const verdicts = [verdict({ plannedSymbol: 'second', rationale: 'second rationale' }), verdict({ plannedSymbol: 'first', rationale: 'first rationale' })];

		const findings = matchDedupVerdicts({ candidates, verdicts });

		expect(findings.map((finding) => [finding.plannedSymbol, finding.rationale])).toStrictEqual([
			['first', 'first rationale'],
			['second', 'second rationale'],
		]);
	});

	test('labels the finding with the plan file that planned it, so the skill edits the right phase', () => {
		const findings = matchDedupVerdicts({ candidates: [candidate({ phase: 'phase4-grade-fanout.md' })], verdicts: [verdict()] });

		// `plannedPath` is where the symbol would live in the repo, which says
		// nothing about which phase file to open
		expect(findings[0]?.phase).toBe('phase4-grade-fanout.md');
	});

	test('carries the extract resolution through with its target location and callers to migrate', () => {
		const ruling = verdict({
			recommendation: DedupResolution.Extract,
			suggestedLocation: 'src/common/utils/formatDate.ts',
			migrateCallers: ['src/standardsCheck/runStandardsCheck.ts'],
		});

		const findings = matchDedupVerdicts({ candidates: [candidate()], verdicts: [ruling] });

		expect(findings[0]?.suggestedLocation).toBe('src/common/utils/formatDate.ts');
		expect(findings[0]?.migrateCallers).toStrictEqual(['src/standardsCheck/runStandardsCheck.ts']);
	});
});
