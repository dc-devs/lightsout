import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import {
	GapArea,
	GapCheckLens,
	GapOutcome,
	type GapVerdict,
	type GradedGap,
	type GradeFindingRecord,
	GradeFindingStatus,
	type GradeMemory,
} from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { judgeGaps } from '#src/plan/common/grading/judgeGaps.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const firstPhaseText = '# Phase 1\n\n## Decision Log\n\nThe reader is spawned once per plan file.\n';
const secondPhaseText = '# Phase 2\n\n## Decision Log\n\nThe judge is spawned once per finding.\n';

/** The two findings each run weighs, one per plan file, so a per-phase slice can be told from the whole memory. */
const firstGapText = 'the plan picks no failure mode';
const secondGapText = 'the plan names no owner for the queue';

/** A judge stub keyed on the finding text each prompt carries, so one run can rule differently per finding whatever order the fan-out starts them in. */
const createJudgeDriver = ({ verdicts, invocations }: { verdicts: Record<string, GapVerdict>; invocations: DriverInvocation[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		// the one marker a gap-judge spawn carries — an invocation without it
		// reached this driver from somewhere else, which is a wiring bug
		expect(invocation.prompt.includes('# Gap-judge input')).toBeTruthy();

		const verdict = Object.entries(verdicts).find(([gap]) => invocation.prompt.includes(gap))?.[1];

		return verdict === undefined ? { text: 'not json at all', exitCode: 1 } : { text: JSON.stringify(verdict), exitCode: 0 };
	},
});

/** One reader finding as the fold hands it to the judges: labelled with its plan file and its lens, and stamped `unjudged` until a verdict lands. */
const gapOf = ({ phase, gap }: { phase: string; gap: string }): GradedGap => ({
	phase,
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap,
	decision: 'name what happens here',
	options: [],
	outcome: GapOutcome.Unjudged,
});

/** One record the memory already holds for a plan file — only its id, phase and gap text reach a judge's prompt. */
const recordOf = ({ id, phase }: { id: string; phase: string }): GradeFindingRecord => ({
	id,
	phase,
	area: GapArea.OmittedDecision,
	gap: `a question already on record for ${phase}`,
	decision: 'settle it',
	options: [],
	firstSeen: '2026-01-01T00:00:00.000Z',
	lastSeen: '2026-01-01T00:00:00.000Z',
	status: GradeFindingStatus.Open,
	disposition: GapOutcome.NeedsAHuman,
	humanDecision: 'pick one',
	reopened: [],
});

/** A two-phase deliverable with one finding and one record per file, plus the stub that answers every judge it spawns. */
const setupJudging = async ({ verdicts }: { verdicts: Record<string, GapVerdict> }) => {
	const cwd = await freshCwd();
	const invocations: DriverInvocation[] = [];
	const memory: GradeMemory = {
		planName: 'demo',
		findings: [recordOf({ id: 'f1', phase: 'phase-1-reader.md' }), recordOf({ id: 'f2', phase: 'phase-2-judge.md' })],
		nextFindingNumber: 3,
		updatedAt: '2026-01-01T00:00:00.000Z',
	};

	return {
		invocations,
		params: {
			cwd,
			driver: createJudgeDriver({ verdicts, invocations }),
			workspaceDir: cwd,
			selected: [
				{ path: join(cwd, 'phase-1-reader.md'), text: firstPhaseText },
				{ path: join(cwd, 'phase-2-judge.md'), text: secondPhaseText },
			],
			gaps: [gapOf({ phase: 'phase-1-reader.md', gap: firstGapText }), gapOf({ phase: 'phase-2-judge.md', gap: secondGapText })],
			memory,
		},
	};
};

/** The prompt the judge of a given finding was handed — the fan-out order is not fixed, so a prompt is found by its finding rather than by its slot. */
const promptFor = ({ invocations, gap }: { invocations: DriverInvocation[]; gap: string }) =>
	invocations.find((invocation) => invocation.prompt.includes(`- finding: ${gap}`))?.prompt ?? '';

describe('judgeGaps', () => {
	test('each judge is shown the records for its own plan file and no other', async () => {
		const { params, invocations } = await setupJudging({
			verdicts: {
				[firstGapText]: { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' },
				[secondGapText]: { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the owner' },
			},
		});

		await judgeGaps(params);

		// the whole memory in every one of twenty prompts is the read-it-all-at-once
		// shape the readers were split away from, and a judge shown another file's
		// record could match a finding to a question that was never about its file
		expect({
			first: { own: promptFor({ invocations, gap: firstGapText }).includes('f1 ('), other: promptFor({ invocations, gap: firstGapText }).includes('f2 (') },
			second: {
				own: promptFor({ invocations, gap: secondGapText }).includes('f2 ('),
				other: promptFor({ invocations, gap: secondGapText }).includes('f1 ('),
			},
		}).toStrictEqual({ first: { own: true, other: false }, second: { own: true, other: false } });
	});

	test('only a record id the memory holds is believed', async () => {
		const { params } = await setupJudging({
			verdicts: {
				[firstGapText]: { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode', matchesFinding: 'f1' },
				[secondGapText]: { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the owner', matchesFinding: 'f99' },
			},
		});

		const result = await judgeGaps(params);

		// an id the plan's memory does not hold points nowhere, exactly as a citation
		// off disk does, so the finding is stamped rather than merged into a record
		// that does not exist
		expect(result.gaps).toEqual([
			expect.objectContaining({ gap: firstGapText, outcome: GapOutcome.NeedsAHuman, findingId: 'f1' }),
			expect.objectContaining({ gap: secondGapText, outcome: GapOutcome.Unjudged, unjudgedReason: expect.stringContaining('f99') }),
		]);
	});
});
