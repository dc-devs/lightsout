import { describe, expect, test } from '@jest/globals';
import { DedupFinding } from '#src/contracts/index.ts';

const setupFinding = (overrides: Record<string, unknown> = {}) => {
	const finding = {
		plannedSymbol: 'formatDate',
		plannedPath: 'src/plan/common/utils/formatDate.ts',
		phase: 'phase2-cross-phase-checks.md',
		recommendation: 'extract',
		rationale: 'the planned symbol restates an existing utility',
		...overrides,
	};

	return { finding };
};

describe('DedupFinding', () => {
	test('a full finding parses with the detected collision and the judged resolution side by side', () => {
		const { finding } = setupFinding({
			collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }],
			suggestedLocation: 'src/common/utils/formatDate.ts',
			migrateCallers: ['src/standardsCheck/runStandardsCheck.ts'],
		});

		const parsed = DedupFinding.parse(finding);

		expect(parsed).toStrictEqual({
			plannedSymbol: 'formatDate',
			plannedPath: 'src/plan/common/utils/formatDate.ts',
			phase: 'phase2-cross-phase-checks.md',
			recommendation: 'extract',
			rationale: 'the planned symbol restates an existing utility',
			collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }],
			suggestedLocation: 'src/common/utils/formatDate.ts',
			migrateCallers: ['src/standardsCheck/runStandardsCheck.ts'],
		});
	});

	test('a finding parses without isDuplicate — the field the omit removed', () => {
		const { finding } = setupFinding();

		const parsed = DedupFinding.parse(finding);

		// runPlanDedup builds findings field by field and never sets isDuplicate — the
		// omit is what lets that object satisfy the schema
		expect(parsed.plannedSymbol).toBe('formatDate');
	});

	test('an isDuplicate carried over from the verdict is stripped, not rejected', () => {
		const { finding } = setupFinding({ isDuplicate: true });

		const parsed = DedupFinding.parse(finding);

		// only confirmed duplicates become findings, so the flag would be a constant
		// true — dropping it is what makes a finding a resolution rather than a ruling
		expect('isDuplicate' in parsed).toBe(false);
	});

	test('collidesWith and migrateCallers default to empty, and suggestedLocation stays absent', () => {
		const { finding } = setupFinding();

		const parsed = DedupFinding.parse(finding);

		// a behavioral duplicate the judge noticed on its own carries no detected name
		// collision
		expect(parsed.collidesWith).toStrictEqual([]);
		// the inherited default survives the omit-and-extend
		expect(parsed.migrateCallers).toStrictEqual([]);
		// the inherited optional survives the omit-and-extend
		expect(parsed.suggestedLocation).toBe(undefined);
	});

	test('recommendation accepts each resolution the menu offers', () => {
		for (const recommendation of ['reuse', 'extend', 'extract', 'defer', 'distinct']) {
			const { finding } = setupFinding({ recommendation });

			const parsed = DedupFinding.parse(finding);

			// ${recommendation} survives the omit-and-extend as a resolution a finding may
			// carry
			expect(parsed.recommendation).toBe(recommendation);
		}
	});

	test('rejects a recommendation outside the resolution menu', () => {
		const { finding } = setupFinding({ recommendation: 'rewrite' });

		const result = DedupFinding.safeParse(finding);

		// the inherited enum still closes the set of resolutions a finding may carry
		expect(result.success).toBe(false);
	});

	test('rejects a finding missing any required field', () => {
		for (const field of ['plannedSymbol', 'plannedPath', 'phase', 'recommendation', 'rationale']) {
			const { finding } = setupFinding({ [field]: undefined });

			const result = DedupFinding.safeParse(finding);

			// ${field} is required — omitting isDuplicate loosens nothing else, and
			// phase plus plannedPath are what point the human at the plan file and the
			// line in it to edit
			expect(result.success).toBe(false);
		}
	});

	test('rejects a collidesWith entry that is not a name/path pair', () => {
		for (const collidesWith of [[{ name: 'formatDate' }], [{ path: 'src/common/utils/formatDate.ts' }], ['src/common/utils/formatDate.ts']]) {
			const { finding } = setupFinding({ collidesWith });

			const result = DedupFinding.safeParse(finding);

			// both halves are needed — neither the name nor the path alone locates the
			// existing export the plan collides with
			expect(result.success).toBe(false);
		}
	});

	test('extra keys on a collidesWith entry are stripped', () => {
		const { finding } = setupFinding({ collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts', line: 12 }] });

		const parsed = DedupFinding.parse(finding);

		// dedup.json holds the pair the contract declares, whatever else the detector
		// happened to know
		expect(parsed.collidesWith).toStrictEqual([{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }]);
	});
});
