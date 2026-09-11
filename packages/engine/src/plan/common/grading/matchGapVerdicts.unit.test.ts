import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { GapArea, type GapBatchVerdict, GapCheckLens, type GapGroupVerdict, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { matchGapVerdicts } from '#src/plan/common/grading/matchGapVerdicts.ts';
import type { GapBatch } from '#src/plan/common/types/GapBatch.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/** A repo root holding real files at the top level and one directory down, so a citation can be pointed at something that is really there. */
const setupRepo = async () => {
	const cwd = await freshCwd();

	await mkdir(join(cwd, 'src'), { recursive: true });
	await writeFile(join(cwd, 'answer.ts'), 'export const answer = 1;\n', 'utf8');
	await writeFile(join(cwd, 'src', 'answer.ts'), 'export const answer = 1;\n', 'utf8');

	return { cwd };
};

/** One reader finding as the fold stamps it: labelled, and unjudged until a judge says otherwise. */
const gapOf = (overrides: Partial<GradedGap> = {}): GradedGap => ({
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: [],
	phase: 'plan.md',
	lens: GapCheckLens.Decisions,
	outcome: GapOutcome.Unjudged,
	observations: [],
	...overrides,
});

/** A judge that answered for a batch of one finding, covering it as `o1` with the evidence its outcome demands unless a case replaces it. */
const ruled = (ruling: Partial<GapGroupVerdict> = {}): AgentOutcome<GapBatchVerdict> => ({
	ok: true,
	report: { verdicts: [{ outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode', covers: ['o1'], answers: [], ...ruling }] },
});

/** A line every single-finding batch's plan text states, long enough to stand as a quoted citation. */
const citedPlanLine = 'A judge that times out leaves its finding unjudged, and it blocks.';

/** Every finding judged in a batch of its own — how a finding with no candidate partner reaches its judge — with the outcome at its index. */
const judgeAlone = ({
	cwd,
	gaps,
	rulings,
	recordIds,
}: {
	cwd: string;
	gaps: GradedGap[];
	rulings: Array<AgentOutcome<GapBatchVerdict> | undefined>;
	recordIds?: Set<string>;
}) =>
	matchGapVerdicts({
		cwd,
		gaps,
		batches: gaps.map((gap, index) => ({
			observations: [{ id: `o${index + 1}`, index, gap }],
			planTexts: [{ phase: gap.phase, text: `# ${gap.phase}\n\n${citedPlanLine}\n` }],
		})),
		batchOutcomes: rulings,
		recordIds,
	});

/** One batch as the batching stage hands it to a judge: each finding under the `o<N>` id its position in the pass earns, plus the text of every plan file they name. */
const batchOf = (members: Array<{ index: number; gap: GradedGap }>): GapBatch => ({
	observations: members.map(({ index, gap }) => ({ id: `o${index + 1}`, index, gap })),
	planTexts: [...new Set(members.map(({ gap }) => gap.phase))].map((phase) => ({ phase, text: `# ${phase}\n` })),
});

/** A batch judge that answered with these rulings. */
const batchRuled = (verdicts: GapBatchVerdict['verdicts']): AgentOutcome<GapBatchVerdict> => ({ ok: true, report: { verdicts } });

describe('matchGapVerdicts', () => {
	test("a judge's ruling is spread onto the finding it was spawned for", async () => {
		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [ruled()] });

		expect(judged).toStrictEqual([{ ...gapOf(), outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' }]);
	});

	test('a finding whose judge never started is unjudged, and says the fan-out stopped', async () => {
		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [undefined] });

		// failing closed: an unweighed finding must never read as a clean bill
		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe('no judge ran — the fan-out stopped before this finding was judged');
	});

	test.each<{ label: string; outcome: AgentOutcome<GapBatchVerdict>; reason: string }>([
		{
			label: 'a rate-limited judge',
			outcome: { ok: false, failure: 'rate limited', rateLimited: true },
			reason: 'the judge was rate limited or overloaded',
		},
		{
			label: 'a judge that never satisfied its contract',
			outcome: { ok: false, failure: 'the agent answered off-contract', rateLimited: false },
			reason: 'the agent answered off-contract',
		},
	])('$label leaves its finding unjudged with the reason on it', async ({ outcome, reason }) => {
		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe(reason);
	});

	test.each<{ label: string; verdict: Partial<GapGroupVerdict> }>([
		{ label: 'needs-a-human with no decision', verdict: { outcome: GapOutcome.NeedsAHuman, humanDecision: '   ' } },
		{ label: 'agent-can-decide with no decision', verdict: { outcome: GapOutcome.AgentCanDecide, safeBecause: 'the standards settle it' } },
		{ label: 'agent-can-decide with no reason it is safe', verdict: { outcome: GapOutcome.AgentCanDecide, agentDecision: 'return null' } },
		{ label: 'already-answered with no citation', verdict: { outcome: GapOutcome.AlreadyAnswered } },
	])('$label is a rubber stamp, so the finding is unjudged', async ({ verdict }) => {
		const outcome = ruled({ humanDecision: undefined, ...verdict });

		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe(`the judge answered ${verdict.outcome} without the evidence that outcome demands`);
	});

	test.each<{ label: string; answerAt: string }>([
		{ label: 'a file that exists under the repo root', answerAt: 'src/answer.ts' },
		{ label: 'a file:symbol citation, whose symbol half is never resolved', answerAt: 'src/answer.ts:noSuchExport' },
		{ label: 'a verbatim line of the plan file it names', answerAt: citedPlanLine },
	])('an already-answered dismissal citing $label stands', async ({ answerAt }) => {
		const outcome = ruled({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, answers: [{ phase: 'plan.md', answerAt }] });

		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.AlreadyAnswered);
		expect(judged[0]?.answerAt).toBe(answerAt);
		expect(judged[0]?.unjudgedReason).toBe(undefined);
	});

	test.each<{ label: string; answerAt: string }>([
		{ label: 'a bare filename, which carries no directory and so is read as a quote', answerAt: 'answer.ts' },
		{ label: 'a standards rule name, which the plan file does not state', answerAt: 'single-use-scalar' },
		{ label: 'a plan location described rather than quoted', answerAt: 'Decision Log row 4' },
	])('an already-answered dismissal citing $label is refused, so the finding is unjudged', async ({ answerAt }) => {
		// a citation that is not a path must be a verbatim line of the plan file it
		// names — the one form of evidence the engine can check without guessing
		const outcome = ruled({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, answers: [{ phase: 'plan.md', answerAt }] });

		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toEqual(expect.stringContaining(answerAt));
	});

	test('an already-answered dismissal citing a file that is not on disk is unjudged', async () => {
		const outcome = ruled({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, answers: [{ phase: 'plan.md', answerAt: 'src/ghost.ts:answer' }] });

		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome] });

		// the citation is the only thing that makes a dismissal checkable — one
		// pointing nowhere is the rubber stamp this branch exists to catch
		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe("the judge's citation for plan.md was refused — cited src/ghost.ts, which is not on disk");
	});

	test('an absolute citation is checked where it points rather than under the repo root', async () => {
		const { cwd } = await setupRepo();
		const outcome = ruled({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, answers: [{ phase: 'plan.md', answerAt: join(cwd, 'answer.ts') }] });

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.AlreadyAnswered);
	});

	test.each<{ outcome: typeof GapOutcome.NeedsAHuman | typeof GapOutcome.AgentCanDecide; verdict: Partial<GapGroupVerdict> }>([
		{ outcome: GapOutcome.NeedsAHuman, verdict: { humanDecision: 'decide it', answers: [{ phase: 'plan.md', answerAt: 'src/ghost.ts' }] } },
		{
			outcome: GapOutcome.AgentCanDecide,
			verdict: { agentDecision: 'create it', safeBecause: 'the plan names the file', answers: [{ phase: 'plan.md', answerAt: 'src/ghost.ts' }] },
		},
	])('a $outcome verdict naming a path that does not exist yet is left alone', async ({ outcome, verdict }) => {
		// the file the plan is about to create is the normal case on these two
		// outcomes, so checking their citations would fail every one of them
		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [ruled({ outcome, humanDecision: undefined, ...verdict })] });

		expect(judged[0]?.outcome).toBe(outcome);
	});

	test('every finding comes back, in its own order, whichever judges answered', async () => {
		const gaps = [gapOf({ gap: 'first' }), gapOf({ gap: 'second' }), gapOf({ gap: 'third' })];
		const rulings = [
			ruled(),
			undefined,
			ruled({
				covers: ['o3'],
				outcome: GapOutcome.AgentCanDecide,
				humanDecision: undefined,
				agentDecision: 'return null',
				safeBecause: 'the standards settle it',
			}),
		];

		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps, rulings });

		// building the result FROM the input is what makes it impossible for a
		// finding to disappear between the readers and the report
		expect(judged.map(({ gap, outcome }) => `${gap}/${outcome}`)).toStrictEqual(['first/needs-a-human', 'second/unjudged', 'third/agent-can-decide']);
	});

	test('a matchesFinding id that names no record is stamped unjudged', async () => {
		// the id is the judge's claim that this finding repeats a record; one no
		// record holds points nowhere, exactly like a citation off disk
		const outcome = ruled({ matchesFinding: 'f9' });

		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome], recordIds: new Set(['f1']) });

		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toEqual(expect.stringContaining('f9'));
		expect(judged[0]?.findingId).toBe(undefined);
	});

	test('a matchesFinding id the plan holds is resolved onto the gap and the raw claim is dropped', async () => {
		const outcome = ruled({ matchesFinding: 'f1' });

		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [outcome], recordIds: new Set(['f1', 'f2']) });

		// what is persisted is the id the engine resolved, never the agent's raw
		// field — a `matchesFinding` on disk would be a claim nothing revalidated
		expect(judged).toStrictEqual([{ ...gapOf(), outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode', findingId: 'f1' }]);
	});

	test('a judge that recognised no record leaves the gap with no findingId at all', async () => {
		const { cwd } = await setupRepo();

		const judged = await judgeAlone({ cwd, gaps: [gapOf()], rulings: [ruled()], recordIds: new Set(['f1']) });

		// an absent claim is not a match to the first record on the list
		expect('findingId' in (judged[0] ?? {})).toBe(false);
	});

	test('keeps input membership and order while scattering one group ruling onto every member', async () => {
		const phaseOneTimeout = gapOf({ gap: 'phase one returns null when the judge times out', phase: 'phase1.md' });
		const phaseOneRetry = gapOf({ gap: 'phase one never says how often to retry', phase: 'phase1.md', lens: GapCheckLens.Surface });
		const phaseTwoTimeout = gapOf({ gap: 'phase two throws when the judge times out', phase: 'phase2.md', area: GapArea.PhaseSeamMismatch });
		const phaseTwoLog = gapOf({ gap: 'phase two never names the log file', phase: 'phase2.md', lens: GapCheckLens.Wiring });
		const phaseTwoExit = gapOf({ gap: 'phase two never names the exit code', phase: 'phase2.md' });
		const gaps = [phaseOneTimeout, phaseOneRetry, phaseTwoTimeout, phaseTwoLog, phaseTwoExit];
		const batches = [
			batchOf([
				{ index: 0, gap: phaseOneTimeout },
				{ index: 2, gap: phaseTwoTimeout },
			]),
			batchOf([
				{ index: 1, gap: phaseOneRetry },
				{ index: 3, gap: phaseTwoLog },
				{ index: 4, gap: phaseTwoExit },
			]),
		];
		const sharedDefect = 'the two phases pick opposite failure modes for one judge timeout';
		const batchOutcomes = [
			batchRuled([{ covers: ['o1', 'o3'], answers: [], outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick one failure mode', sharedDefect }]),
			batchRuled([
				{ covers: ['o2'], answers: [], outcome: GapOutcome.AgentCanDecide, agentDecision: 'retry once', safeBecause: 'the standards settle it' },
				{ covers: ['o4'], answers: [], outcome: GapOutcome.NeedsAHuman, humanDecision: 'name the log file' },
				{ covers: ['o5'], answers: [], outcome: GapOutcome.NeedsAHuman, humanDecision: 'name the exit code' },
			]),
		];

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps, batches, batchOutcomes });

		// the findings drive the loop, so a batch fan-out whose task count no longer
		// equals the finding count still cannot drop or reorder one
		expect(judged.map(({ gap, outcome, groupId }) => `${gap}/${outcome}/${groupId === undefined ? 'single' : 'grouped'}`)).toStrictEqual([
			'phase one returns null when the judge times out/needs-a-human/grouped',
			'phase one never says how often to retry/agent-can-decide/single',
			'phase two throws when the judge times out/needs-a-human/grouped',
			'phase two never names the log file/needs-a-human/single',
			'phase two never names the exit code/needs-a-human/single',
		]);
		expect(judged[0]).toEqual(
			expect.objectContaining({
				groupId: expect.any(String),
				sharedDefect,
				observations: [
					expect.objectContaining({ phase: 'phase1.md', gap: 'phase one returns null when the judge times out' }),
					expect.objectContaining({ phase: 'phase2.md', gap: 'phase two throws when the judge times out' }),
				],
			}),
		);
		expect(judged[2]).toEqual(expect.objectContaining({ groupId: judged[0]?.groupId, sharedDefect, observations: judged[0]?.observations }));
	});

	test("preserves a carried gap's record id when the verdict names no match", async () => {
		// a pending record carried forward already knows its record; dropping the id
		// here would open a second record for the same finding on every pass
		const carried = gapOf({ findingId: 'f4', unjudgedReason: 'the judge was rate limited or overloaded' });
		const batchOutcomes = [batchRuled([{ covers: ['o1'], answers: [], outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' }])];

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({
			cwd,
			gaps: [carried],
			batches: [batchOf([{ index: 0, gap: carried }])],
			batchOutcomes,
			recordIds: new Set(['f4']),
		});

		expect(judged[0]).toEqual(expect.objectContaining({ outcome: GapOutcome.NeedsAHuman, findingId: 'f4' }));
	});

	test("a carried finding's stale unjudged reason is cleared once a judge rules on it", async () => {
		const carried = gapOf({ findingId: 'f4', unjudgedReason: 'the judge was rate limited or overloaded' });
		const batchOutcomes = [batchRuled([{ covers: ['o1'], answers: [], outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' }])];

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({
			cwd,
			gaps: [carried],
			batches: [batchOf([{ index: 0, gap: carried }])],
			batchOutcomes,
			recordIds: new Set(['f4']),
		});

		// the earlier pass's reason would otherwise ride the needs-a-human line as a refusal nobody made
		expect(judged[0]?.unjudgedReason).toBe(undefined);
		expect(judged[0]?.humanDecision).toBe('pick the failure mode');
	});

	test('leaves a gap no batch held unjudged with the default reason', async () => {
		const batched = gapOf({ gap: 'batched' });
		const orphaned = gapOf({ gap: 'orphaned', phase: 'renamed-away.md' });
		const batchOutcomes = [batchRuled([{ covers: ['o1'], answers: [], outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' }])];

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps: [batched, orphaned], batches: [batchOf([{ index: 0, gap: batched }])], batchOutcomes });

		// failing closed: a finding no judge was ever offered must block, never vanish
		expect(judged[1]).toEqual(
			expect.objectContaining({ outcome: GapOutcome.Unjudged, unjudgedReason: 'no judge ran — the fan-out stopped before this finding was judged' }),
		);
	});
});
