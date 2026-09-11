import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { GradeMemory } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { gradeMemoryPath } from '#src/plan/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { gapCheckLensOf } from '#tests/helpers/gapCheckLensOf.ts';
import { secondPhaseBody } from '#tests/helpers/secondPhaseBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// What a grading pass does to the plan's finding memory: the baseline an
// unfinished pass must not move, the memory a first pass starts from nothing,
// and the memory a pass refuses to run against at all.

/** One decision-level gap, as a checker reports it. */
const omittedDecisionGap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: [] };

/** Prose with no JSON object in it — what a reader returns when it never answers on contract. */
const offContractProse = 'the plan looks fine to me';

/** The timestamp the seeded baseline carries, so a rewritten one is recognisable. */
const baselineAt = '2026-01-01T00:00:00.000Z';

/**
 * A fingerprint from an earlier pass that shares nothing with the current one:
 * every hash is a literal, so the pass under test can only decide a full review
 * and can never mistake this for a reusable one.
 */
const staleInputs = {
	planFiles: [{ file: 'phase1-core.md', sha256: 'stale-phase-one' }],
	gradedCommit: 'stalecommit',
	changedFiles: [],
	config: 'stale-config',
	prompts: 'stale-prompts',
	sha256: 'stale-combined',
};

/**
 * A two-phase plan whose second phase's reader never answers on contract, over a
 * memory already holding a baseline from a complete pass.
 *
 * The failing reader is told from the answering one by the plan text under
 * check, and a re-emit — whose prompt is the reconstruct instruction rather than
 * the plan — is answered off contract too, because the only reader failing here
 * is the second phase's.
 */
const setupLostReader = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlanDeliverable({
		cwd,
		name,
		files: {
			'overview.md': cleanOverviewBody(),
			'phase1-core.md': cleanPlanBody({ title: 'Graded Plan', reference: true }),
			'phase2-extra.md': secondPhaseBody(),
		},
	});

	writeFileSync(
		join(dir, 'grade-memory.json'),
		JSON.stringify({
			planName: name,
			findings: [],
			lastPass: { scope: 'full', inputs: staleInputs, at: baselineAt },
			nextFindingNumber: 1,
			updatedAt: baselineAt,
		}),
	);

	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			if (invocation.prompt.includes('# Gap-judge input')) {
				const covers = [...invocation.prompt.matchAll(/^### (o\d+)$/gm)].map(([, id]) => id);

				return { text: JSON.stringify({ verdicts: [{ covers, outcome: 'needs-a-human', humanDecision: 'what the plan should do here' }] }), exitCode: 0 };
			}

			if (invocation.prompt.includes('# Validation error') || invocation.prompt.includes('src/other-thing.ts')) {
				return { text: offContractProse, exitCode: 0 };
			}

			// One lens reports the finding and the other two report nothing, so the
			// merged record set has exactly one member to state.
			return { text: JSON.stringify({ gaps: gapCheckLensOf(invocation) === 'decisions' ? [omittedDecisionGap] : [] }), exitCode: 0 };
		},
	};

	return { cwd, name, driver, memoryPath: gradeMemoryPath({ cwd, name }) };
};

/** A clean single plan with no memory file beside it, and a stub whose readers find nothing. */
const setupFirstPass = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();

	writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan' }) });

	return { cwd, name, driver: createGapCheckDriver(), memoryPath: gradeMemoryPath({ cwd, name }) };
};

/** The same clean plan, over a memory file that is valid JSON and not a `GradeMemory`, read by a driver that must never be spawned. */
const setupMalformedMemory = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();
	const dir = writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan' }) });
	const malformed = '{ "planName": 5 }';

	writeFileSync(join(dir, 'grade-memory.json'), malformed);

	return {
		cwd,
		name,
		malformed,
		driver: createUncalledDriver({ reason: 'a malformed memory file must stop the pass before any agent is spawned' }),
		memoryPath: gradeMemoryPath({ cwd, name }),
		gradePath: join(dir, 'grade.json'),
	};
};

describe('runPlanGrade', () => {
	test('plan grade: a pass that lost a reader does not become the scope baseline', async () => {
		const { cwd, name, driver, memoryPath } = setupLostReader({ name: 'lost-reader' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'failed');
		expect(result.grade?.complete).toBe(false);

		const memory = GradeMemory.parse(JSON.parse(readFileSync(memoryPath, 'utf8')));

		// what the reader that DID answer found is kept
		expect(memory.findings).toEqual([expect.objectContaining({ phase: 'phase1-core.md', gap: 'no error handling decided', status: 'open' })]);
		// and the baseline the next pass narrows against is still the last complete
		// pass's: a pass that never read a phase cannot vouch for that phase's text
		expect(memory.lastPass).toEqual(expect.objectContaining({ at: baselineAt }));
		expect(memory.lastPass?.inputs.sha256).toBe('stale-combined');
	});

	test('plan grade: an absent memory file yields a full review and a fresh memory', async () => {
		const { cwd, name, driver, memoryPath } = setupFirstPass({ name: 'first-pass' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// nothing was on record to narrow against, so every plan file was offered to
		// the readers
		expect(result.grade.scope).toBe('full');
		expect(result.grade.passed).toBe(true);
		expect(existsSync(memoryPath)).toBeTruthy();

		const memory = GradeMemory.parse(JSON.parse(readFileSync(memoryPath, 'utf8')));

		expect(memory).toEqual(expect.objectContaining({ planName: 'first-pass', findings: [] }));
		expect(memory.lastPass?.scope).toBe('full');
		// and the passing full review is recorded against the fingerprint this pass
		// measured, which is what a later pass compares itself to
		expect(typeof memory.lastPassingFullReview?.inputs.sha256).toBe('string');
		expect(memory.lastPassingFullReview?.inputs.sha256).toBe(result.grade.inputs?.sha256);
	});

	test('plan grade: a malformed memory file fails the pass before any spawn', async () => {
		const { cwd, name, driver, malformed, memoryPath, gradePath } = setupMalformedMemory({ name: 'malformed-memory' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'failed');
		// the message names the file a human has to look at
		expect(result.error).toContain(memoryPath);
		// nothing was spawned, nothing was graded, and the unreadable record was left
		// exactly as it was rather than being overwritten with a fresh one
		expect(existsSync(gradePath)).toBe(false);
		expect(readFileSync(memoryPath, 'utf8')).toBe(malformed);
	});
});
