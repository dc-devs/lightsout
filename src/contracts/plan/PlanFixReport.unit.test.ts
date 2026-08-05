import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanFixReport } from '@/contracts';

test('PlanFixReport: a full repair report parses with every field preserved', () => {
	const parsed = PlanFixReport.parse({
		status: 'fixed',
		filesEdited: ['/abs/path/plan.md'],
		discrepancies: [],
	});

	assert.deepEqual(parsed, {
		status: 'fixed',
		filesEdited: ['/abs/path/plan.md'],
		discrepancies: [],
	});
});

test('PlanFixReport: filesEdited and discrepancies default to empty arrays when omitted', () => {
	const parsed = PlanFixReport.parse({ status: 'error' });

	assert.deepEqual(parsed, { status: 'error', filesEdited: [], discrepancies: [] }, 'a bare status is a complete report — the arrays are optional for the agent');
});

test('PlanFixReport: status accepts only the fix outcomes, not the draft status set', () => {
	const fixed = PlanFixReport.safeParse({ status: 'fixed' });
	const error = PlanFixReport.safeParse({ status: 'error' });

	assert.equal(fixed.success, true);
	assert.equal(error.success, true);
	assert.equal(PlanFixReport.safeParse({ status: 'drafted' }).success, false, "the repair role never authors — 'drafted' is PlanDraftReport vocabulary");
	assert.equal(PlanFixReport.safeParse({ status: 'Fixed' }).success, false, 'values are lowercase, matching the runPlanDraft status check');
	assert.equal(PlanFixReport.safeParse({}).success, false, 'status is required');
});

test('PlanFixReport: non-string array entries are rejected', () => {
	const result = PlanFixReport.safeParse({ status: 'fixed', filesEdited: [42] });

	assert.equal(result.success, false);
});

test('PlanFixReport: an error report carries the reasons the findings could not be resolved', () => {
	const parsed = PlanFixReport.parse({
		status: 'error',
		discrepancies: ['the flagged section names a file the plan never writes', 'no decision covers the ordering the finding asks for'],
	});

	assert.deepEqual(
		parsed,
		{
			status: 'error',
			filesEdited: [],
			discrepancies: ['the flagged section names a file the plan never writes', 'no decision covers the ordering the finding asks for'],
		},
		'a declining repairer edits nothing and states why — repairPlanStructure reads those reasons off the parsed report',
	);
});

test('PlanFixReport: a fixed report keeps every edited path, in the order the repairer reported them', () => {
	const parsed = PlanFixReport.parse({
		status: 'fixed',
		filesEdited: ['.notes/plans/packages-to-src/overview.md', '.notes/plans/packages-to-src/phase-1-move.md'],
	});

	assert.deepEqual(parsed.filesEdited, ['.notes/plans/packages-to-src/overview.md', '.notes/plans/packages-to-src/phase-1-move.md'], 'one repair invocation may touch several plan files; the array is the list, not a single path');
});

test('PlanFixReport: non-string entries in discrepancies are rejected', () => {
	const result = PlanFixReport.safeParse({ status: 'error', discrepancies: ['a valid reason', 42] });

	assert.equal(result.success, false, 'discrepancies holds prose a human reads — a non-string entry is not a reason');
});

test('PlanFixReport: a bare string in place of either array is rejected', () => {
	for (const field of ['filesEdited', 'discrepancies']) {
		const result = PlanFixReport.safeParse({ status: 'fixed', [field]: 'plan.md' });

		assert.equal(result.success, false, `${field} is a list — a lone string is a malformed report, not a one-entry array`);
	}
});

test('PlanFixReport: an explicit null on either array is rejected rather than defaulted', () => {
	for (const field of ['filesEdited', 'discrepancies']) {
		const result = PlanFixReport.safeParse({ status: 'fixed', [field]: null });

		assert.equal(result.success, false, `${field} defaults only when omitted — an explicit null is the agent stating a value, and it is not a list`);
	}
});

test('PlanFixReport: unknown top-level keys are stripped', () => {
	const parsed = PlanFixReport.parse({ status: 'fixed', filesEdited: [], discrepancies: [], notes: 'an extra field the agent volunteered', planName: 'packages-to-src' });

	assert.deepEqual(Object.keys(parsed).sort(), ['discrepancies', 'filesEdited', 'status'], 'a repairer that volunteers extra fields still produces a parseable report — the surplus is dropped, not rejected');
});
