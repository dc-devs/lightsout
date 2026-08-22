import { describe, expect, test } from '@jest/globals';
import { StructuralFinding } from '#src/contracts/index.ts';

const setupFinding = (overrides: Record<string, unknown> = {}) => {
	const finding = {
		check: 'path-exists',
		severity: 'blocking',
		phase: 'plan.md',
		issue: 'the plan names src/plan/runPlanGrade.ts, which does not exist',
		location: 'Files to Modify, line 42',
		fix: 'point the entry at src/plan/runPlanGrade.ts or drop it',
		...overrides,
	};

	return { finding };
};

describe('StructuralFinding', () => {
	test('a full finding parses with the failed check, its severity, its plan file, its location, and the exact fix preserved', () => {
		const { finding } = setupFinding();

		const parsed = StructuralFinding.parse(finding);

		expect(parsed).toStrictEqual({
			check: 'path-exists',
			severity: 'blocking',
			phase: 'plan.md',
			issue: 'the plan names src/plan/runPlanGrade.ts, which does not exist',
			location: 'Files to Modify, line 42',
			fix: 'point the entry at src/plan/runPlanGrade.ts or drop it',
		});
	});

	test('check accepts each deterministic lint the plan is graded against', () => {
		for (const check of [
			'path-exists',
			'script-exists',
			'no-placeholders',
			'sections-present',
			'scope-within-guardrail',
			'naming-matches',
			'packages-identifiable',
			'file-provenance',
			'handoff-chained',
			'declaration-consistent',
			'created-files-within-ceiling',
			'phase-count',
			'move-well-formed',
		]) {
			const { finding } = setupFinding({ check });

			const parsed = StructuralFinding.parse(finding);

			// ${check} is one of the checks lintPlanStructure may report a defect for —
			// the per-file ones and the cross-phase ones alike
			expect(parsed.check).toBe(check);
		}
	});

	test('rejects a check outside the structural lint set', () => {
		const { finding } = setupFinding({ check: 'imports-resolve' });

		const result = StructuralFinding.safeParse(finding);

		// the check set is closed — a finding naming a lint the engine never runs
		// would print a defect no fix could clear
		expect(result.success).toBe(false);
	});

	test('rejects the capitalized key form of a check', () => {
		const { finding } = setupFinding({ check: 'PathExists' });

		const result = StructuralFinding.safeParse(finding);

		// the enum is built from the StructuralCheck values, not its capitalized keys
		expect(result.success).toBe(false);
	});

	test('rejects a finding missing any required field', () => {
		for (const field of ['check', 'phase', 'issue', 'location', 'fix']) {
			const { finding } = setupFinding({ [field]: undefined });

			const result = StructuralFinding.safeParse(finding);

			// ${field} is required — the repair agent needs all of them to act without
			// re-deriving the defect, and `phase` is what says which plan file to open
			expect(result.success).toBe(false);
		}
	});

	test('severity defaults to blocking, so a grade.json written before the field existed still reads as gating', () => {
		const { finding } = setupFinding({ severity: undefined });

		const parsed = StructuralFinding.parse(finding);

		// the default is for the read boundary, not for producers: every one of
		// them builds the field explicitly
		expect(parsed.severity).toBe('blocking');
	});

	test('severity accepts both levels and nothing else', () => {
		for (const severity of ['blocking', 'advisory']) {
			expect(StructuralFinding.parse(setupFinding({ severity }).finding).severity).toBe(severity);
		}

		// a third level would be a finding that neither gates nor informs
		expect(StructuralFinding.safeParse(setupFinding({ severity: 'error' }).finding).success).toBe(false);
	});

	test('rejects a non-string location or fix rather than coercing it', () => {
		for (const overrides of [{ location: 42 }, { fix: ['drop the entry'] }]) {
			const { finding } = setupFinding(overrides);

			const result = StructuralFinding.safeParse(finding);

			// location is the prose pointer printed beside the check and fix is one
			// instruction — neither is coerced from a line number or a list of candidate
			// edits
			expect(result.success).toBe(false);
		}
	});

	test('extra keys are stripped', () => {
		const { finding } = setupFinding({ gradedBy: 'claude-code' });

		const parsed = StructuralFinding.parse(finding);

		// a finding carries only the six declared fields — how hard it gates is
		// `severity` and nothing else a hand edit added
		expect('gradedBy' in parsed).toBe(false);
		expect(Object.keys(parsed).sort()).toStrictEqual(['check', 'fix', 'issue', 'location', 'phase', 'severity']);
	});
});
