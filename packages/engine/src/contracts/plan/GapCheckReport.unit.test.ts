import { describe, expect, test } from '@jest/globals';
import { GapCheckReport } from '@/contracts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const gap = {
		area: 'unwired-dependency',
		gap: 'the plan adds a standards rule but never says which command runs it',
		decision: 'name the command that invokes the new detector',
		options: ['lightsout standards-check', 'lightsout verify'],
	};
	const report = {
		gaps: [gap],
		...overrides,
	};

	return { report, gap };
};

describe('GapCheckReport', () => {
	test('a report parses with its gaps intact', () => {
		const { report } = setupReport();

		const parsed = GapCheckReport.parse(report);

		expect(parsed).toStrictEqual({
			gaps: [
				{
					area: 'unwired-dependency',
					gap: 'the plan adds a standards rule but never says which command runs it',
					decision: 'name the command that invokes the new detector',
					options: ['lightsout standards-check', 'lightsout verify'],
				},
			],
		});
	});

	test('gaps defaults to empty — a plan the agent found nothing wrong with is still a report', () => {
		const parsed = GapCheckReport.parse({});

		// runPlanGrade reads gaps off the parsed report without guarding for absence,
		// so a bare {} from the agent must read back as no gaps
		expect(parsed.gaps).toStrictEqual([]);
	});

	test('an explicitly empty gaps array parses', () => {
		const { report } = setupReport({ gaps: [] });

		const parsed = GapCheckReport.parse(report);

		expect(parsed.gaps).toStrictEqual([]);
	});

	test('nested gap defaults are applied when the agent frames no options', () => {
		const { report } = setupReport({
			gaps: [{ area: 'ambiguous-boundary', gap: 'two modules could own the new detector', decision: 'name the owning module' }],
		});

		const parsed = GapCheckReport.parse(report);

		// the nested default reaches every gap, so the skill renders an option list
		// off each one without a guard
		expect(parsed.gaps[0]).toStrictEqual({
			area: 'ambiguous-boundary',
			gap: 'two modules could own the new detector',
			decision: 'name the owning module',
			options: [],
		});
	});

	test('one malformed gap rejects the whole report', () => {
		const { report } = setupReport({
			gaps: [{ area: 'insufficient-detail', gap: 'this entry names no decision' }],
		});

		const result = GapCheckReport.safeParse(report);

		// a partly readable report is refused at the agent boundary rather than
		// grading a plan against half its gaps
		expect(result.success).toBe(false);
	});

	test('an out-of-enum area on a nested gap rejects the report', () => {
		const { report, gap } = setupReport();

		const result = GapCheckReport.safeParse({ ...report, gaps: [{ ...gap, area: 'missing-context' }] });

		// the nested enum stays closed through the array — an invented area never
		// reaches grade.json
		expect(result.success).toBe(false);
	});

	test('rejects a gaps value that is not an array', () => {
		const { report, gap } = setupReport();

		const result = GapCheckReport.safeParse({ ...report, gaps: gap });

		// a single gap object in place of the list is a malformed report
		expect(result.success).toBe(false);
	});

	test('extra keys on the report are stripped', () => {
		const { report } = setupReport({ planName: 'packages-to-src' });

		const parsed = GapCheckReport.parse(report);

		// the gap-check contract carries gaps and nothing else — runPlanGrade supplies
		// the plan identity itself
		expect(Object.keys(parsed)).toStrictEqual(['gaps']);
	});
});
