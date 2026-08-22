import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkPhaseCount } from '#src/plan/index.ts';

describe('checkPhaseCount', () => {
	test.each([{ phaseCount: 1 }, { phaseCount: 8 }])('$phaseCount phases sit on the soft threshold rather than over it', ({ phaseCount }) => {
		const findings = checkPhaseCount({ phaseCount, overviewBase: 'overview.md' });

		expect(findings).toStrictEqual([]);
	});

	test('a ninth phase raises an advisory counting the gap-check agents one grading pass runs', () => {
		const findings = checkPhaseCount({ phaseCount: 9, overviewBase: 'overview.md' });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.PhaseCount,
				severity: FindingSeverity.Advisory,
				phase: 'overview.md',
				issue: expect.stringContaining('9 phases'),
				location: 'overview.md → Phases',
				fix: expect.stringContaining('27'),
			},
		]);
	});

	test('the note states three lenses per phase rather than a gap total the engine cannot know', () => {
		const findings = checkPhaseCount({ phaseCount: 12, overviewBase: 'plan-overview.md' });

		// 12 * 3 is counted, not predicted — a guessed gap count would be an
		// invented number in a message a human acts on
		expect(findings[0]?.issue).toMatch(/12 phases.*36 gap-check agents/);
		expect(findings[0]?.phase).toBe('plan-overview.md');
	});
});
