import { describe, expect, test } from '@jest/globals';
import type { DecisionsRecord } from '#src/contracts/index.ts';
import { syncPlanDecisions } from '#src/plan/decisionLog/index.ts';
import {
	decisionLogPlanBody,
	decisionTableRows,
	planDecisionRow,
	planSectionBody,
	setupDecisionLogPlan,
	setupOverviewOnlyPlan,
	setupPhasedDecisionLogPlan,
	updatedByFile,
} from '#tests/helpers/decisionLogPlan.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';

/** The heading whose body every assertion below reads. */
const decisionLog = 'Decision Log';

// A caller that states its own plan paths owns where the table lives: the
// deliverable is never resolved, the workspace's own record is never read when
// one is handed in, and a path outside the list is never written.

describe('syncPlanDecisions', () => {
	test('syncPlanDecisions: renders the record it was handed instead of reading the workspace', async () => {
		const plan = setupDecisionLogPlan({ record: false });
		const decisions: DecisionsRecord = {
			planName: plan.name,
			decisions: [planDecisionRow({ question: 'Whose rows are these?', choice: 'The ones the caller handed in' })],
		};

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: plan.name, decisions });

		expectStatus(result, 'complete');
		const section = planSectionBody({ heading: decisionLog, text: plan.readPlan() });
		// there is no decisions.json to read, so a synced table proves the handed
		// rows were the ones rendered
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: decisionTableRows({ section }).length,
			choice: section.includes('The ones the caller handed in'),
		}).toStrictEqual({ reported: { 'plan.md': true }, rows: 1, choice: true });
	});

	test('syncPlanDecisions: syncs the paths it is handed for a workspace whose deliverable does not resolve', async () => {
		const draft = setupOverviewOnlyPlan();
		const decisions: DecisionsRecord = {
			planName: draft.name,
			decisions: [planDecisionRow({ question: 'Which record is rendered?', choice: 'The one the draft is holding' })],
		};

		const result = await syncPlanDecisions({ cwd: draft.cwd, name: draft.name, planPaths: [draft.overviewPath], decisions });

		expectStatus(result, 'complete');
		const section = planSectionBody({ heading: decisionLog, text: draft.readFile('overview.md') });
		// stated paths and a stated record together: neither the deliverable nor the
		// workspace's own decisions.json is read, and the overview still gets the table
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: decisionTableRows({ section }).length,
			handedChoice: section.includes('The one the draft is holding'),
		}).toStrictEqual({ reported: { 'overview.md': true }, rows: 1, handedChoice: true });
	});

	test('syncPlanDecisions: fails on that same overview-only workspace when it is handed no paths', async () => {
		const draft = setupOverviewOnlyPlan();

		const result = await syncPlanDecisions({ cwd: draft.cwd, name: draft.name });

		expectStatus(result, 'failed');
		// the resolver reads an overview with no phase file beside it as no plan, so
		// the stated paths above are what made the difference — and nothing is written
		expect({ error: result.error, text: draft.readFile('overview.md') }).toEqual({
			error: expect.stringContaining('no plan found'),
			text: decisionLogPlanBody({ title: 'Overview' }),
		});
	});

	test('syncPlanDecisions: picks each handed path a rendering from its name and leaves every other file alone', async () => {
		const phased = setupPhasedDecisionLogPlan();

		const result = await syncPlanDecisions({
			cwd: phased.cwd,
			name: phased.name,
			planPaths: [phased.path('overview.md'), phased.path('phase1-core.md')],
		});

		expectStatus(result, 'complete');
		const overview = planSectionBody({ heading: decisionLog, text: phased.readFile('overview.md') });
		const first = planSectionBody({ heading: decisionLog, text: phased.readFile('phase1-core.md') });

		// the name decides the rendering for a stated path exactly as it does for a
		// resolved one, and the phase file left out of the list is untouched
		expect({
			reported: updatedByFile({ files: result.files }),
			overviewRows: decisionTableRows({ section: overview }).length,
			firstRows: decisionTableRows({ section: first }).length,
			firstPoints: first.includes('overview.md'),
			second: phased.readFile('phase2-wire.md'),
		}).toStrictEqual({
			reported: { 'overview.md': true, 'phase1-core.md': true },
			overviewRows: 2,
			firstRows: 0,
			firstPoints: true,
			second: decisionLogPlanBody({ title: 'Phase 2 — Wire' }),
		});
	});

	test('syncPlanDecisions: syncs handed phase paths with no overview beside them rather than refusing them', async () => {
		const phased = setupPhasedDecisionLogPlan({ overview: false });

		const result = await syncPlanDecisions({ cwd: phased.cwd, name: phased.name, planPaths: [phased.path('phase1-core.md')] });

		expectStatus(result, 'complete');
		const first = planSectionBody({ heading: decisionLog, text: phased.readFile('phase1-core.md') });
		// the refusal over a missing overview belongs to the resolved path only: the
		// caller that states its paths owns where the table lives
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: decisionTableRows({ section: first }).length,
			points: first.includes('overview.md'),
		}).toStrictEqual({ reported: { 'phase1-core.md': true }, rows: 0, points: true });
	});
});
