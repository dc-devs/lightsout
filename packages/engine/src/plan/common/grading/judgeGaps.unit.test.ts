import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import {
	GapArea,
	type GapBatchVerdict,
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

/**
 * A judge stub keyed on the finding text each prompt carries, so one run can
 * rule differently per finding whatever order the fan-out starts them in. Each
 * finding here is a batch of its own, so the ruling covers every engine
 * identifier the prompt names.
 */
const createJudgeDriver = ({ verdicts, invocations }: { verdicts: Record<string, GapVerdict>; invocations: DriverInvocation[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		// the one marker a gap-judge spawn carries — an invocation without it
		// reached this driver from somewhere else, which is a wiring bug
		expect(invocation.prompt.includes('# Gap-judge input')).toBeTruthy();

		const verdict = Object.entries(verdicts).find(([gap]) => invocation.prompt.includes(gap))?.[1];
		const covers = [...new Set(invocation.prompt.match(/\bo\d+\b/g) ?? [])];

		return verdict === undefined ? { text: 'not json at all', exitCode: 1 } : { text: JSON.stringify({ verdicts: [{ ...verdict, covers }] }), exitCode: 0 };
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
	observations: [],
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
	observations: [],
	resolutions: [],
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
			files: [
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

/** Four findings worded so only the first two share distinctive words — `ceiling` and `budget` — across their finding and decision text. */
const ceilingGap = { gap: 'the retry budget never states its ceiling', decision: 'choose the retry ceiling' };
const contradictionGap = { gap: 'the ceiling on the retry budget contradicts phase one', decision: 'reconcile both' };
const ownerGap = { gap: 'the queue owner is never named', decision: 'assign somebody' };
const loggingGap = { gap: 'logging verbosity is left open', decision: 'settle verbosity' };

/** One finding as the judge stage receives it once batching exists: its own decision text, and no observations because one reader raised it. */
const batchGapOf = ({ phase, gap, decision }: { phase: string; gap: string; decision: string }): GradedGap => ({
	phase,
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap,
	decision,
	options: [],
	outcome: GapOutcome.Unjudged,
	observations: [],
});

/** One record in any state, optionally holding observations across several plan files — only its id, status and gap text reach a judge's prompt. */
const batchRecordOf = ({
	id,
	phase,
	gap,
	status = GradeFindingStatus.Open,
	observations = [],
	supersededBy,
}: {
	id: string;
	phase: string;
	gap: string;
	status?: GradeFindingStatus;
	observations?: GradeFindingRecord['observations'];
	supersededBy?: string;
}): GradeFindingRecord => ({
	id,
	phase,
	area: GapArea.OmittedDecision,
	gap,
	decision: 'settle it',
	options: [],
	firstSeen: '2026-01-01T00:00:00.000Z',
	lastSeen: '2026-01-01T00:00:00.000Z',
	status,
	disposition: GapOutcome.NeedsAHuman,
	humanDecision: 'pick one',
	reopened: [],
	observations,
	resolutions: [],
	supersededBy,
});

/**
 * A batch-judge stub that answers every batch with one ruling covering every
 * engine identifier its prompt names — a confirmed group, with its shared defect,
 * when there are two or more. The identifiers are read from the prompt rather
 * than assumed, so the stub answers whatever batches the engine assembled, in
 * whatever order the fan-out starts them.
 */
const createBatchJudgeDriver = ({ ruling, invocations }: { ruling: Omit<GapVerdict, 'answerAt'>; invocations: DriverInvocation[] }): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		// the one marker a gap-judge spawn carries — an invocation without it
		// reached this driver from somewhere else, which is a wiring bug
		expect(invocation.prompt.includes('# Gap-judge input')).toBeTruthy();

		const covers = [...new Set(invocation.prompt.match(/\bo\d+\b/g) ?? [])];
		const verdict: GapBatchVerdict = {
			verdicts: [{ ...ruling, covers, answers: [], ...(covers.length > 1 ? { sharedDefect: 'the retry ceiling is stated two different ways' } : {}) }],
		};

		return { text: JSON.stringify(verdict), exitCode: 0 };
	},
});

/** A two-phase deliverable whose every plan file is handed to the judge stage, plus the stub that rules every batch it spawns. */
const setupBatchJudging = async ({
	gaps,
	findings = [],
	ruling = { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the ceiling' },
	skipReason,
}: {
	gaps: GradedGap[];
	findings?: GradeFindingRecord[];
	ruling?: Omit<GapVerdict, 'answerAt'>;
	skipReason?: string;
}) => {
	const cwd = await freshCwd();
	const invocations: DriverInvocation[] = [];
	const memory: GradeMemory = { planName: 'demo', findings, nextFindingNumber: 11, updatedAt: '2026-01-01T00:00:00.000Z' };

	return {
		invocations,
		params: {
			cwd,
			driver: createBatchJudgeDriver({ ruling, invocations }),
			workspaceDir: cwd,
			files: [
				{ path: join(cwd, 'phase-1-reader.md'), text: firstPhaseText },
				{ path: join(cwd, 'phase-2-judge.md'), text: secondPhaseText },
			],
			gaps,
			skipReason,
			memory,
		},
	};
};

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

	test('hides a superseded record from the judge and refuses a verdict naming it', async () => {
		const survivorGap = 'the question that now carries the absorbed obligation';
		const supersededGap = 'the question whose obligation moved elsewhere';
		const { params, invocations } = await setupBatchJudging({
			gaps: [batchGapOf({ phase: 'phase-1-reader.md', ...ownerGap })],
			findings: [
				batchRecordOf({ id: 'f1', phase: 'phase-1-reader.md', gap: survivorGap }),
				batchRecordOf({ id: 'f7', phase: 'phase-1-reader.md', gap: supersededGap, status: GradeFindingStatus.Superseded, supersededBy: 'f1' }),
			],
			ruling: { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the owner', matchesFinding: 'f7' },
		});

		const result = await judgeGaps(params);

		// a superseded record's question lives on its survivor, so matching a fresh
		// finding to it would attach that finding to a record nothing checks or closes
		expect({
			prompts: invocations.map((invocation) => ({ survivor: invocation.prompt.includes(survivorGap), superseded: invocation.prompt.includes(supersededGap) })),
			gaps: result.gaps,
		}).toEqual({
			prompts: [{ survivor: true, superseded: false }],
			gaps: [expect.objectContaining({ gap: ownerGap.gap, outcome: GapOutcome.Unjudged, unjudgedReason: expect.stringContaining('f7') })],
		});
	});

	test('spawns one judge per batch rather than one per finding', async () => {
		const { params, invocations } = await setupBatchJudging({
			gaps: [
				batchGapOf({ phase: 'phase-1-reader.md', ...ceilingGap }),
				batchGapOf({ phase: 'phase-2-judge.md', ...contradictionGap }),
				batchGapOf({ phase: 'phase-1-reader.md', ...ownerGap }),
				batchGapOf({ phase: 'phase-2-judge.md', ...loggingGap }),
			],
		});

		const result = await judgeGaps(params);
		const groupIds = result.gaps.map((gap) => gap.groupId);

		// the two findings sharing `ceiling` and `budget` reach one judge across
		// both plan files, and the two with no partner are judged exactly as before
		expect({
			spawns: invocations.length,
			outcomes: result.gaps.map((gap) => gap.outcome),
			batchedTogether: groupIds[0] !== undefined && groupIds[0] === groupIds[1],
			unbatched: groupIds.slice(2),
		}).toStrictEqual({
			spawns: 3,
			outcomes: [GapOutcome.NeedsAHuman, GapOutcome.NeedsAHuman, GapOutcome.NeedsAHuman, GapOutcome.NeedsAHuman],
			batchedTogether: true,
			unbatched: [undefined, undefined],
		});
	});

	test("lists a record spanning two of a batch's phases only once", async () => {
		const recordGap = 'a question already on record across both plan files';
		const { params, invocations } = await setupBatchJudging({
			gaps: [batchGapOf({ phase: 'phase-1-reader.md', ...ceilingGap }), batchGapOf({ phase: 'phase-2-judge.md', ...contradictionGap })],
			findings: [
				batchRecordOf({
					id: 'f1',
					phase: 'phase-1-reader.md',
					gap: recordGap,
					observations: [
						{ phase: 'phase-1-reader.md', lens: GapCheckLens.Decisions, area: GapArea.OmittedDecision, gap: recordGap, decision: 'settle it', options: [] },
						{
							phase: 'phase-2-judge.md',
							lens: GapCheckLens.Decisions,
							area: GapArea.OmittedDecision,
							gap: 'the same question seen from the judge phase',
							decision: 'settle it',
							options: [],
						},
					],
				}),
			],
		});

		await judgeGaps(params);

		// a grouped record is returned once per phase it touches, and a judge shown
		// it twice would read one question as two
		expect(invocations.map((invocation) => invocation.prompt.split(recordGap).length - 1)).toStrictEqual([1]);
	});

	test('spawns no judge and leaves every finding unjudged when the fan-out was skipped', async () => {
		const skipReason = 'the reader fan-out hit the rate-limit wall';
		const { params, invocations } = await setupBatchJudging({
			gaps: [batchGapOf({ phase: 'phase-1-reader.md', ...ceilingGap }), batchGapOf({ phase: 'phase-2-judge.md', ...ownerGap })],
			skipReason,
		});

		const result = await judgeGaps(params);

		// a wall met by launching more spawns into it is still a wall, and a finding
		// nobody weighed must block rather than vanish
		expect({ spawns: invocations.length, gaps: result.gaps }).toEqual({
			spawns: 0,
			gaps: [
				expect.objectContaining({ gap: ceilingGap.gap, outcome: GapOutcome.Unjudged, unjudgedReason: skipReason }),
				expect.objectContaining({ gap: ownerGap.gap, outcome: GapOutcome.Unjudged, unjudgedReason: skipReason }),
			],
		});
	});
});
