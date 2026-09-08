import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { DecisionSource, type DecisionsRecord, FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import type { SyncedPlanFile } from '#src/plan/decisionLog/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { dirtyPlanBody } from '#tests/helpers/dirtyPlanBody.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { createRepairDriver, runRepairLoop, setupRepairDraft } from '#tests/helpers/repairDraftFixture.ts';

// The Decision Log the repair loop owns: the sync that runs ahead of every
// lint, and the merged record the draft hands down instead of a second read of
// the workspace.

// Mocked Imports
// -------------------------
/** The sync runner as the repair loop calls it: the draft's own paths and the record it was started from, never a second read of the workspace. */
interface SyncParams {
	cwd: string;
	name: string;
	planPaths?: string[];
	decisions?: DecisionsRecord;
}

const mockSyncPlanDecisions = jest.fn<(params: SyncParams) => Promise<{ status: 'complete'; files: SyncedPlanFile[] }>>();

// The barrel re-exports this file, so both import styles reach the double.
jest.mock('#src/plan/decisionLog/syncPlanDecisions.ts', () => ({
	syncPlanDecisions: (params: SyncParams) => mockSyncPlanDecisions(params),
}));
// -------------------------

// Every round of the loop syncs before it lints, so the runner stands in for
// every case in this file; the two cases that measure it re-wire it themselves.
mockSyncPlanDecisions.mockResolvedValue({ status: 'complete', files: [] });

/**
 * A drafted plan whose sync stands in for the engine's own: every call clears
 * `strips` from each file it is handed, so a marker the sync clears can only
 * reach the lint if the lint ran first.
 */
const setupSyncedDraft = ({ body, strips }: { body: string; strips?: string }) => {
	const draft = setupRepairDraft({ body });

	mockSyncPlanDecisions.mockImplementation(async ({ planPaths = [] }) => {
		if (strips !== undefined) {
			for (const path of planPaths) {
				writeFileSync(path, readFileSync(path, 'utf8').replace(`${strips} `, ''));
			}
		}

		return { status: 'complete', files: planPaths.map((path) => ({ path, updated: true })) };
	});

	return draft;
};

/** A merged record carrying one settled row — a history the clean skeleton, whose log is rendered from an empty record, does not carry. */
const recordWithOneRow = (): DecisionsRecord => ({
	planName: 'demo',
	decisions: [
		{
			source: DecisionSource.Grill,
			question: 'Does the repair loop lint against the record it was handed?',
			options: 'the handed record / a second read of the workspace',
			choice: 'the handed record',
			rationale: 'the draft holds the one merged record it was started from',
			assumption: false,
		},
	],
});

/** A merged record whose row came from the brainstorm — a row the plan's own decisions.json never holds, and this workspace holds no decisions.json at all. */
const mergedRecordWithBrainstormRow = (): DecisionsRecord => ({
	planName: 'demo',
	decisions: [
		{
			source: DecisionSource.Brainstorm,
			question: 'Which record does the repair loop lint against?',
			options: 'the merged record the draft holds / the workspace file',
			choice: 'the merged record the draft holds',
			rationale: 'the brainstorm rows are only in the merged set',
			assumption: false,
		},
	],
});

describe('repairPlanStructure decision log', () => {
	test("repairPlanStructure: the loop's lint is given the merged decision record", async () => {
		// the clean skeleton's Decision Log is rendered from an empty record, so a
		// record carrying one row is a log the plan on disk disagrees with
		const draft = setupRepairDraft({ body: cleanPlanBody() });
		const prompts: string[] = [];
		const driver = createRepairDriver({
			onCall: (prompt) => prompts.push(prompt),
			respond: () => ({
				text: JSON.stringify({ status: 'error', filesEdited: [], discrepancies: ['the Decision Log is composed by the sync command, not by a repair'] }),
				exitCode: 0,
			}),
		});

		const result = await runRepairLoop({ ...draft, driver, decisions: recordWithOneRow() });

		expectStatus(result, 'complete');
		// the record travels into the loop's own lint, so the staleness it creates
		// is a finding the repairer is handed rather than one nobody ever sees
		expect(prompts[0]).toContain(`[${StructuralCheck.DecisionLogCurrent}]`);
		expect('findings' in result && result.findings.map(({ check, severity }) => ({ check, severity }))).toStrictEqual([
			{ check: StructuralCheck.DecisionLogCurrent, severity: FindingSeverity.Blocking },
		]);
	});

	test('every repair round syncs the Decision Log before it re-lints', async () => {
		// Four planted markers, one of them cleared by the sync — and every repair
		// re-introduces it, the way a repair that displaces the engine's section
		// does. 3 → 2 → 1 → 0 findings, so all three repairs run.
		const draft = setupSyncedDraft({ body: dirtyPlanBody({ markers: 'TBD TODO ??? {token}' }), strips: 'TBD' });
		const messages: string[] = [];
		const driver = createRepairDriver({
			bodies: [dirtyPlanBody({ markers: 'TBD TODO ???' }), dirtyPlanBody({ markers: 'TBD TODO' }), dirtyPlanBody({ markers: 'TBD' })],
		});

		const result = await runRepairLoop({ ...draft, driver, progress: (message) => messages.push(message) });

		expectStatus(result, 'complete');
		// three rounds plus the opening check
		expect(mockSyncPlanDecisions).toHaveBeenCalledTimes(4);
		// the counts prove the order: a lint that ran first would have counted the
		// re-introduced marker and narrated 4, 3 and 2 findings instead
		expect(messages).toEqual([
			expect.stringMatching(/3 structural finding\(s\).*repair 1\/3/),
			expect.stringMatching(/2 structural finding\(s\).*repair 2\/3/),
			expect.stringMatching(/1 structural finding\(s\).*repair 3\/3/),
		]);
		// and the plan the loop hands back is clean, though every repairer output
		// carried the marker the sync cleared
		expect('findings' in result && result.findings).toStrictEqual([]);
	});

	test("the lint is handed the draft's merged decisions rather than re-reading them", async () => {
		// The clean skeleton's log is rendered from an empty record, and the
		// workspace holds no decisions.json at all: a lint that read the workspace
		// would find no rows and call this log current.
		const draft = setupSyncedDraft({ body: cleanPlanBody() });
		const driver = createRepairDriver({
			respond: () => ({
				text: JSON.stringify({ status: 'error', filesEdited: [], discrepancies: ['the Decision Log is composed by the engine, not by a repair'] }),
				exitCode: 0,
			}),
		});

		const result = await runRepairLoop({ ...draft, driver, decisions: mergedRecordWithBrainstormRow() });

		expectStatus(result, 'complete');
		// the brainstorm row reached the lint, so the log that does not carry it is
		// the blocking staleness the loop reports
		expect('findings' in result && result.findings.map(({ check, severity }) => ({ check, severity }))).toStrictEqual([
			{ check: StructuralCheck.DecisionLogCurrent, severity: FindingSeverity.Blocking },
		]);
		expect('findings' in result && result.findings[0]?.issue).toMatch(/saved decision records/);
	});

	test("the sync is handed the draft's own paths and merged record, so it resolves neither for itself", async () => {
		// This workspace holds no decisions.json and no resolvable deliverable: a
		// sync left to read the record or to resolve the plan would compose from
		// nothing, so the loop states both.
		const draft = setupSyncedDraft({ body: cleanPlanBody() });
		const driver = createRepairDriver({
			respond: () => ({
				text: JSON.stringify({ status: 'error', filesEdited: [], discrepancies: ['the Decision Log is composed by the engine, not by a repair'] }),
				exitCode: 0,
			}),
		});

		const result = await runRepairLoop({ ...draft, driver, decisions: mergedRecordWithBrainstormRow() });

		expectStatus(result, 'complete');
		expect(mockSyncPlanDecisions).toHaveBeenCalledWith({
			cwd: draft.cwd,
			name: 'demo',
			planPaths: [draft.planPath],
			decisions: mergedRecordWithBrainstormRow(),
		});
	});
});
