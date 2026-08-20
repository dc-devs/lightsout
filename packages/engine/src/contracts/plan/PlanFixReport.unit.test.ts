import { expect, test } from '@jest/globals';
import { PlanFixReport } from '#src/contracts/index.ts';

test('PlanFixReport: a full repair report parses with every field preserved', () => {
	const parsed = PlanFixReport.parse({
		status: 'fixed',
		filesEdited: ['/abs/path/plan.md'],
		discrepancies: [],
	});

	expect(parsed).toStrictEqual({
		status: 'fixed',
		filesEdited: ['/abs/path/plan.md'],
		discrepancies: [],
	});
});

test('PlanFixReport: filesEdited and discrepancies default to empty arrays when omitted', () => {
	const parsed = PlanFixReport.parse({ status: 'error' });

	// a bare status is a complete report — the arrays are optional for the agent
	expect(parsed).toStrictEqual({ status: 'error', filesEdited: [], discrepancies: [] });
});

test('PlanFixReport: status accepts only the fix outcomes, not the draft status set', () => {
	const fixed = PlanFixReport.safeParse({ status: 'fixed' });
	const error = PlanFixReport.safeParse({ status: 'error' });

	expect(fixed.success).toBe(true);
	expect(error.success).toBe(true);
	// the repair role never authors — 'drafted' is PlanDraftReport vocabulary
	expect(PlanFixReport.safeParse({ status: 'drafted' }).success).toBe(false);
	// values are lowercase, matching the runPlanDraft status check
	expect(PlanFixReport.safeParse({ status: 'Fixed' }).success).toBe(false);
	// status is required
	expect(PlanFixReport.safeParse({}).success).toBe(false);
});

test('PlanFixReport: non-string array entries are rejected', () => {
	const result = PlanFixReport.safeParse({ status: 'fixed', filesEdited: [42] });

	expect(result.success).toBe(false);
});

test('PlanFixReport: an error report carries the reasons the findings could not be resolved', () => {
	const parsed = PlanFixReport.parse({
		status: 'error',
		discrepancies: ['the flagged section names a file the plan never writes', 'no decision covers the ordering the finding asks for'],
	});

	// a declining repairer edits nothing and states why — repairPlanStructure
	// reads those reasons off the parsed report
	expect(parsed).toStrictEqual({
		status: 'error',
		filesEdited: [],
		discrepancies: ['the flagged section names a file the plan never writes', 'no decision covers the ordering the finding asks for'],
	});
});

test('PlanFixReport: a fixed report keeps every edited path, in the order the repairer reported them', () => {
	const parsed = PlanFixReport.parse({
		status: 'fixed',
		filesEdited: ['.notes/plans/packages-to-src/overview.md', '.notes/plans/packages-to-src/phase-1-move.md'],
	});

	// one repair invocation may touch several plan files; the array is the list,
	// not a single path
	expect(parsed.filesEdited).toStrictEqual(['.notes/plans/packages-to-src/overview.md', '.notes/plans/packages-to-src/phase-1-move.md']);
});

test('PlanFixReport: non-string entries in discrepancies are rejected', () => {
	const result = PlanFixReport.safeParse({ status: 'error', discrepancies: ['a valid reason', 42] });

	// discrepancies holds prose a human reads — a non-string entry is not a reason
	expect(result.success).toBe(false);
});

test('PlanFixReport: a bare string in place of either array is rejected', () => {
	for (const field of ['filesEdited', 'discrepancies']) {
		const result = PlanFixReport.safeParse({ status: 'fixed', [field]: 'plan.md' });

		// ${field} is a list — a lone string is a malformed report, not a one-entry
		// array
		expect(result.success).toBe(false);
	}
});

test('PlanFixReport: an explicit null on either array is rejected rather than defaulted', () => {
	for (const field of ['filesEdited', 'discrepancies']) {
		const result = PlanFixReport.safeParse({ status: 'fixed', [field]: null });

		// ${field} defaults only when omitted — an explicit null is the agent stating
		// a value, and it is not a list
		expect(result.success).toBe(false);
	}
});

test('PlanFixReport: unknown top-level keys are stripped', () => {
	const parsed = PlanFixReport.parse({
		status: 'fixed',
		filesEdited: [],
		discrepancies: [],
		notes: 'an extra field the agent volunteered',
		planName: 'packages-to-src',
	});

	// a repairer that volunteers extra fields still produces a parseable report —
	// the surplus is dropped, not rejected
	expect(Object.keys(parsed).sort()).toStrictEqual(['discrepancies', 'filesEdited', 'status']);
});
