import { describe, expect, test } from '@jest/globals';
import { PlanFixReport } from '#src/contracts/index.ts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const report = {
		status: 'fixed',
		filesEdited: ['/abs/path/plan.md'],
		discrepancies: [],
		...overrides,
	};

	return { report };
};

describe('PlanFixReport', () => {
	test('a full repair report parses with every field preserved', () => {
		const { report } = setupReport();

		const parsed = PlanFixReport.parse(report);

		expect(parsed).toStrictEqual({
			status: 'fixed',
			filesEdited: ['/abs/path/plan.md'],
			discrepancies: [],
		});
	});

	test('filesEdited and discrepancies default to empty arrays when omitted', () => {
		const { report } = setupReport({ status: 'error', filesEdited: undefined, discrepancies: undefined });

		const parsed = PlanFixReport.parse(report);

		// a bare status is a complete report — the arrays are optional for the agent
		expect(parsed).toStrictEqual({ status: 'error', filesEdited: [], discrepancies: [] });
	});

	test('status accepts the fixed outcome', () => {
		const { report } = setupReport({ status: 'fixed' });

		const result = PlanFixReport.safeParse(report);

		expect(result.success).toBe(true);
	});

	test('status accepts the error outcome', () => {
		const { report } = setupReport({ status: 'error' });

		const result = PlanFixReport.safeParse(report);

		expect(result.success).toBe(true);
	});

	test('rejects a status from the draft outcome set', () => {
		const { report } = setupReport({ status: 'drafted' });

		const result = PlanFixReport.safeParse(report);

		// the repair role never authors — 'drafted' is PlanDraftReport vocabulary
		expect(result.success).toBe(false);
	});

	test('rejects a capitalized status', () => {
		const { report } = setupReport({ status: 'Fixed' });

		const result = PlanFixReport.safeParse(report);

		// the values are the lowercase strings the plan-repairer agent emits in its
		// JSON report
		expect(result.success).toBe(false);
	});

	test('rejects a report with no status', () => {
		const { report } = setupReport({ status: undefined });

		const result = PlanFixReport.safeParse(report);

		// status is required
		expect(result.success).toBe(false);
	});

	test('non-string filesEdited entries are rejected', () => {
		const { report } = setupReport({ filesEdited: [42] });

		const result = PlanFixReport.safeParse(report);

		expect(result.success).toBe(false);
	});

	test('an error report carries the reasons the findings could not be resolved', () => {
		const { report } = setupReport({
			status: 'error',
			filesEdited: undefined,
			discrepancies: ['the flagged section names a file the plan never writes', 'no decision covers the ordering the finding asks for'],
		});

		const parsed = PlanFixReport.parse(report);

		// a declining repairer edits nothing and states why — repairPlanStructure
		// reads those reasons off the parsed report
		expect(parsed).toStrictEqual({
			status: 'error',
			filesEdited: [],
			discrepancies: ['the flagged section names a file the plan never writes', 'no decision covers the ordering the finding asks for'],
		});
	});

	test('a fixed report keeps every edited path, in the order the repairer reported them', () => {
		const { report } = setupReport({
			filesEdited: ['.notes/plans/packages-to-src/overview.md', '.notes/plans/packages-to-src/phase-1-move.md'],
		});

		const parsed = PlanFixReport.parse(report);

		// one repair invocation may touch several plan files; the array is the list,
		// not a single path
		expect(parsed.filesEdited).toStrictEqual(['.notes/plans/packages-to-src/overview.md', '.notes/plans/packages-to-src/phase-1-move.md']);
	});

	test('non-string entries in discrepancies are rejected', () => {
		const { report } = setupReport({ status: 'error', discrepancies: ['a valid reason', 42] });

		const result = PlanFixReport.safeParse(report);

		// discrepancies holds prose a human reads — a non-string entry is not a reason
		expect(result.success).toBe(false);
	});

	test('a bare string in place of either array is rejected', () => {
		for (const field of ['filesEdited', 'discrepancies']) {
			const { report } = setupReport({ [field]: 'plan.md' });

			const result = PlanFixReport.safeParse(report);

			// ${field} is a list — a lone string is a malformed report, not a one-entry
			// array
			expect(result.success).toBe(false);
		}
	});

	test('an explicit null on either array is rejected rather than defaulted', () => {
		for (const field of ['filesEdited', 'discrepancies']) {
			const { report } = setupReport({ [field]: null });

			const result = PlanFixReport.safeParse(report);

			// ${field} defaults only when omitted — an explicit null is the agent stating
			// a value, and it is not a list
			expect(result.success).toBe(false);
		}
	});

	test('unknown top-level keys are stripped', () => {
		const { report } = setupReport({
			filesEdited: [],
			notes: 'an extra field the agent volunteered',
			planName: 'packages-to-src',
		});

		const parsed = PlanFixReport.parse(report);

		// a repairer that volunteers extra fields still produces a parseable report —
		// the surplus is dropped, not rejected
		expect(Object.keys(parsed).sort()).toStrictEqual(['discrepancies', 'filesEdited', 'status']);
	});
});
