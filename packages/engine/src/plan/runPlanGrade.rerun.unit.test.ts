import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { GradeReport } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createOffContractDriver } from '#tests/helpers/createOffContractDriver.ts';
import { createRateLimitedDriver } from '#tests/helpers/createRateLimitedDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { gapCheckLensOf } from '#tests/helpers/gapCheckLensOf.ts';
import { secondPhaseBody } from '#tests/helpers/secondPhaseBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// What the reader re-run does to the graded pass: the coverage a recovered
// reader wins back, and the bound that keeps a reader which never recovers from
// re-running forever.

/** One decision-level gap, as a checker reports it. */
const omittedDecisionGap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: [] };

/** Prose with no JSON object in it — the shape the 2026-08-25 rejected payloads had. */
const offContractProse = 'the plan looks fine to me';

/** A consumer repo holding one clean single plan, plus the collector the act writes into. */
const setupSingle = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();
	const dir = writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan' }) });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, invocations, gradePath: join(dir, 'grade.json') };
};

/** A consumer repo holding a two-phase plan, plus the collector the act writes into. */
const setupPhased = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlanDeliverable({
		cwd,
		name,
		files: {
			'overview.md': cleanOverviewBody(),
			'phase1-core.md': cleanPlanBody({ title: 'Graded Plan' }),
			'phase2-extra.md': secondPhaseBody(),
		},
	});
	const invocations: DriverInvocation[] = [];

	return { cwd, name, invocations, gradePath: join(dir, 'grade.json') };
};

test('plan grade: a reader that answers on its re-run gets its phase claimed as checked', async () => {
	const { cwd, name, invocations, gradePath } = setupSingle({ name: 'rerun-recovered' });
	const seenLenses = new Set<string>();
	// Every reader answers off-contract the first time its lens is seen and on
	// contract every time after; the judges are on contract throughout, so the
	// case turns only on the readers. The lens rides the SYSTEM prompt, which a
	// fresh role invocation carries unchanged — that is what tells a reader's
	// first rung from its second.
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			if (invocation.prompt.includes('# Gap-judge input')) {
				return { text: JSON.stringify({ outcome: 'needs-a-human', humanDecision: 'what the plan should do here' }), exitCode: 0 };
			}

			const lens = gapCheckLensOf(invocation) ?? '';

			if (!seenLenses.has(lens)) {
				seenLenses.add(lens);

				return { text: offContractProse, exitCode: 0 };
			}

			return { text: JSON.stringify({ gaps: [omittedDecisionGap] }), exitCode: 0 };
		},
	};

	const result = await runPlanGrade({ cwd, driver, name });

	// no reader was written off
	expectStatus(result, 'complete');

	const readerInvocations = invocations.filter(({ prompt }) => !prompt.includes('# Gap-judge input'));

	// three lenses, each spending its first role invocation and answering on its
	// second — the judges cannot mask a wrong reader count
	expect(readerInvocations.length).toBe(6);
	// the rejected prose held no object, so each second spawn was a fresh role
	// invocation rather than a re-emit asked to restate a sentence
	expect(invocations.some(({ prompt }) => prompt.includes('# Validation error'))).toBe(false);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// the coverage the write-off used to cost: today this list would be empty
	expect(recorded.phasesChecked).toStrictEqual(['plan.md']);
	expect(recorded.complete).toBe(true);
	expect(recorded.incompleteReason).toBe(undefined);
});

test('plan grade: a reader that never recovers stops after its second role attempt and still cannot pass', async () => {
	const { cwd, name, invocations, gradePath } = setupPhased({ name: 'rerun-exhausted' });
	const driver = createOffContractDriver({ text: offContractProse, invocations });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'failed');
	// two plan files × three lenses × two role attempts, and not one spawn more:
	// a re-run that were unbounded would burn the whole pass budget here
	expect(invocations.length).toBe(12);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.phasesChecked).toStrictEqual([]);
	expect(recorded.complete).toBe(false);
	expect(recorded.passed).toBe(false);
});

test('plan grade: a rate-limited reader parks the pass rather than being re-run into the same wall', async () => {
	const { cwd, name, invocations, gradePath } = setupSingle({ name: 'rerun-walled' });
	const driver = createRateLimitedDriver({ invocations });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// one spawn per lens, not two: a wall returns from the first rung, and the
	// ceiling never multiplies it
	expect(invocations.length).toBe(3);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.complete).toBe(false);
	expect(recorded.passed).toBe(false);
});
