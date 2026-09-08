import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { DecisionRow } from '#src/contracts/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createScriptedDraftDriver, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow, setupPhasedDraft } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';

// Where a phased draft composes the engine-owned Decision Log: the overview
// before the door check reads it, the overview again before the phase writers
// are handed its text, and the phase files before their counts are stamped.

/**
 * One settled row, as the planning session writes it into decisions.json. Every
 * fixture body renders its `## Decision Log` from an EMPTY record, so a workspace
 * holding this row makes each authored body stale on arrival — and the composed
 * section is then visible by the words only this row carries.
 */
const settledRow: DecisionRow = {
	source: 'Elicitation',
	question: 'which split?',
	options: 'one phase / two',
	choice: 'one phase',
	rationale: 'the work is one seam',
	assumption: false,
};

/** A phased draft whose saved record holds the one settled row. */
const setupRecordedPhasedDraft = ({ name }: { name: string }) => {
	const draft = setupPhasedDraft({ name });

	writeFileSync(join(draft.planDir, 'decisions.json'), JSON.stringify({ planName: name, decisions: [settledRow] }));

	return draft;
};

describe('runPlanDraft decision log', () => {
	test('the overview is synced by explicit path before any phase file exists to resolve', async () => {
		const draft = setupRecordedPhasedDraft({ name: 'synced-overview' });
		// The reshape spawn is the first moment the test can look at the workspace
		// after the door check has read it, and before any phase file exists.
		const atDoorCheck: { overview: string; phaseExists: boolean }[] = [];
		const driver = createScriptedDraftDriver({
			respond: ({ role, path }) => {
				if (role === 'overview') {
					return overviewBody({ rows: [phaseRow({ created: 31 })] });
				}

				if (role === 'reshape') {
					atDoorCheck.push({
						overview: readFileSync(join(draft.planDir, 'overview.md'), 'utf8'),
						phaseExists: existsSync(join(draft.planDir, 'phase1-core.md')),
					});

					return overviewBody({ rows: [phaseRow()] });
				}

				return role === 'phase' ? cleanPlanBody({ reference: true }) : unchangedFixReport({ path });
			},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'complete');
		// resolvePlanDeliverable answers `no plan found` for a folder holding only
		// overview.md, so a log composed there came from the explicit path
		expect(atDoorCheck).toEqual([{ overview: expect.stringContaining('| 1 | Elicitation | which split? |'), phaseExists: false }]);
	});

	test('a reshaped overview is re-synced before the phase writers are handed its text', async () => {
		const draft = setupRecordedPhasedDraft({ name: 'resynced-overview' });
		const driver = createScriptedDraftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) => {
				if (role === 'overview') {
					return overviewBody({ rows: [phaseRow({ created: 31 })] });
				}

				// the reshaper rewrites the whole file, putting the empty-record log back
				return role === 'reshape' ? overviewBody({ rows: [phaseRow()] }) : role === 'phase' ? cleanPlanBody({ reference: true }) : unchangedFixReport({ path });
			},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'complete');

		const phasePrompt = draft.calls.find(({ role }) => role === 'phase')?.prompt;

		expectDefined(phasePrompt);
		// a phase writer authors against the overview text in its prompt, never the
		// file, so an overview synced only on disk would still fan out stale
		expect({
			composed: phasePrompt.includes('| 1 | Elicitation | which split? |'),
			reshaperLeftIt: phasePrompt.includes('No decisions recorded.'),
		}).toStrictEqual({ composed: true, reshaperLeftIt: false });
	});

	test('the phase files are synced before their counts are stamped', async () => {
		const draft = setupRecordedPhasedDraft({ name: 'synced-phases' });
		const driver = createScriptedDraftDriver({
			onCall: (call) => draft.calls.push(call),
			// the declared counts are deliberately wrong, so the stamp is visible; the
			// phase body carries a single plan's table where the pointer belongs
			respond: ({ role, path }) =>
				role === 'overview'
					? overviewBody({ rows: [phaseRow({ created: 9, touched: 9 })] })
					: role === 'phase'
						? cleanPlanBody()
						: unchangedFixReport({ path }),
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'complete');

		const phase = readFileSync(join(draft.planDir, 'phase1-core.md'), 'utf8');

		// the stamped row proves the counts were taken from the phase file, and the
		// swapped section proves the sync reached it first — a phase file keeps one
		// pointer at the overview's history rather than a second copy of it
		expect({
			pointer: phase.includes('the log in overview.md'),
			table: phase.includes('| 1 | Elicitation | which split? |'),
			stamped: readFileSync(join(draft.planDir, 'overview.md'), 'utf8').includes('| 1 | `phase1-core.md` | the work | 1 | 1 |'),
			roles: draft.calls.map(({ role }) => role),
		}).toStrictEqual({ pointer: true, table: false, stamped: true, roles: ['overview', 'phase'] });
	});
});
