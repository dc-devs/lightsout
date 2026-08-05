import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PlanDraftReport } from '@/contracts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const report = {
		status: 'drafted',
		filesWritten: [{ path: '.notes/plans/add-verify-facts.md', variant: 'single', scope: 'single' }],
		decisionsApplied: 4,
		...overrides,
	};

	return { report };
};

describe('PlanDraftReport', () => {
	test('a full phased draft report parses with every file, count and note preserved', () => {
		const { report } = setupReport({
			filesWritten: [
				{ path: '.notes/plans/add-verify-facts/overview.md', variant: 'overview', scope: 'single' },
				{ path: '.notes/plans/add-verify-facts/phase-1-contracts.md', variant: 'phase', scope: 'phase-1-contracts' },
			],
			assumptions: ['the api package is named core'],
			discrepancies: ['src/gone.ts does not exist'],
		});

		const parsed = PlanDraftReport.parse(report);

		assert.deepEqual(parsed, {
			status: 'drafted',
			filesWritten: [
				{ path: '.notes/plans/add-verify-facts/overview.md', variant: 'overview', scope: 'single' },
				{ path: '.notes/plans/add-verify-facts/phase-1-contracts.md', variant: 'phase', scope: 'phase-1-contracts' },
			],
			decisionsApplied: 4,
			assumptions: ['the api package is named core'],
			discrepancies: ['src/gone.ts does not exist'],
		});
	});

	test('filesWritten, assumptions and discrepancies default to empty arrays when omitted', () => {
		const { report } = setupReport({ filesWritten: undefined });

		const parsed = PlanDraftReport.parse(report);

		assert.deepEqual(
			parsed,
			{ status: 'drafted', filesWritten: [], decisionsApplied: 4, assumptions: [], discrepancies: [] },
			'a status and a decision count are a complete report — the writer agent may omit the three arrays',
		);
	});

	test('status accepts each draft outcome', () => {
		for (const status of ['drafted', 'error']) {
			const { report } = setupReport({ status });

			const parsed = PlanDraftReport.parse(report);

			assert.equal(parsed.status, status, `${status} is one of the two outcomes a draft run can end in`);
		}
	});

	test('rejects a status outside the draft outcome set', () => {
		for (const status of ['fixed', 'complete', 'Drafted', 'ERROR']) {
			const { report } = setupReport({ status });

			const result = PlanDraftReport.safeParse(report);

			assert.equal(result.success, false, `${status} is not a draft outcome — the values are lowercase, matching the report.status === 'error' check in runPlanDraft`);
		}
	});

	test('rejects a report with no status', () => {
		const { report } = setupReport({ status: undefined });

		const result = PlanDraftReport.safeParse(report);

		assert.equal(result.success, false, 'status is required — it is what tells runPlanDraft whether to hand the plan on or fail the run');
	});

	test('variant accepts each shape a written plan file may take', () => {
		for (const variant of ['single', 'overview', 'phase']) {
			const { report } = setupReport({ filesWritten: [{ path: '.notes/plans/add-verify-facts.md', variant, scope: 'single' }] });

			const parsed = PlanDraftReport.parse(report);

			assert.equal(parsed.filesWritten[0]?.variant, variant, `${variant} is a deliverable shape the writer may report`);
		}
	});

	test('rejects a variant outside the plan shape set, including the CLI scope flag value', () => {
		for (const variant of ['phased', 'Single', 'overview.md', '']) {
			const { report } = setupReport({ filesWritten: [{ path: '.notes/plans/add-verify-facts.md', variant, scope: 'single' }] });

			const result = PlanDraftReport.safeParse(report);

			assert.equal(result.success, false, `${variant} is not a plan variant — the CLI maps --scope phased to overview before the writer ever reports a file`);
		}
	});

	test('a filesWritten entry carries its scope as a free-form slug', () => {
		const { report } = setupReport({ filesWritten: [{ path: '.notes/plans/add-verify-facts/phase-2-engine.md', variant: 'phase', scope: 'phase-2-engine' }] });

		const parsed = PlanDraftReport.parse(report);

		assert.equal(parsed.filesWritten[0]?.scope, 'phase-2-engine', 'the scope is the phase slug the file covers — the contract does not close that set');
	});

	test('rejects a filesWritten entry missing any of path, variant or scope', () => {
		for (const field of ['path', 'variant', 'scope']) {
			const { report } = setupReport({ filesWritten: [{ path: '.notes/plans/add-verify-facts.md', variant: 'single', scope: 'single', [field]: undefined }] });

			const result = PlanDraftReport.safeParse(report);

			assert.equal(result.success, false, `${field} is required on every written file — the three together are what locate the deliverable and say what it covers`);
		}
	});

	test('extra keys on a filesWritten entry are stripped', () => {
		const { report } = setupReport({ filesWritten: [{ path: '.notes/plans/add-verify-facts.md', variant: 'single', scope: 'single', bytes: 4096 }] });

		const parsed = PlanDraftReport.parse(report);

		assert.deepEqual(parsed.filesWritten, [{ path: '.notes/plans/add-verify-facts.md', variant: 'single', scope: 'single' }], 'the report holds the triple the contract declares, whatever else the writer happened to know');
	});

	test('a decisionsApplied of zero parses as the count it is', () => {
		const { report } = setupReport({ decisionsApplied: 0 });

		const parsed = PlanDraftReport.parse(report);

		assert.equal(parsed.decisionsApplied, 0, 'a draft that applied no decisions reports zero — the field is required, so zero must survive rather than read as absent');
	});

	test('rejects a decisionsApplied that is absent or not a number', () => {
		for (const decisionsApplied of [undefined, '4', null, true]) {
			const { report } = setupReport({ decisionsApplied });

			const result = PlanDraftReport.safeParse(report);

			assert.equal(result.success, false, `${String(decisionsApplied)} is not a decision count — the field carries no default, so the writer must state it`);
		}
	});

	test('rejects non-string entries in assumptions and discrepancies', () => {
		for (const field of ['assumptions', 'discrepancies']) {
			const { report } = setupReport({ [field]: ['a valid note', 42] });

			const result = PlanDraftReport.safeParse(report);

			assert.equal(result.success, false, `${field} holds prose the human reads — a non-string entry is not a note`);
		}
	});

	test('unknown top-level keys are stripped', () => {
		const { report } = setupReport({ notes: 'an extra field the agent volunteered', planName: 'add-verify-facts' });

		const parsed = PlanDraftReport.parse(report);

		assert.deepEqual(
			Object.keys(parsed).sort(),
			['assumptions', 'decisionsApplied', 'discrepancies', 'filesWritten', 'status'],
			'a writer that volunteers extra fields still produces a parseable report — the surplus is dropped, not rejected',
		);
	});
});
