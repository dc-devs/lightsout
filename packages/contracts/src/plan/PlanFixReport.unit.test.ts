import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanFixReport } from '../index';

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
