import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GapVerdict, type GradedGap } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { matchGapVerdicts } from '#src/plan/common/utils/matchGapVerdicts.ts';
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
	...overrides,
});

/** A judge that answered, with the evidence its outcome demands unless a case removes it. */
const ruled = (verdict: Partial<GapVerdict> = {}): AgentOutcome<GapVerdict> => ({
	ok: true,
	report: { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode', ...verdict },
});

describe('matchGapVerdicts', () => {
	test("a judge's ruling is spread onto the finding it was spawned for", async () => {
		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [ruled()] });

		expect(judged).toStrictEqual([{ ...gapOf(), outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' }]);
	});

	test('a finding whose judge never started is unjudged, and says the fan-out stopped', async () => {
		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [undefined] });

		// failing closed: an unweighed finding must never read as a clean bill
		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe('no judge ran — the fan-out stopped before this finding was judged');
	});

	test.each<{ label: string; outcome: AgentOutcome<GapVerdict>; reason: string }>([
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

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe(reason);
	});

	test.each<{ label: string; verdict: Partial<GapVerdict> }>([
		{ label: 'needs-a-human with no decision', verdict: { outcome: GapOutcome.NeedsAHuman, humanDecision: '   ' } },
		{ label: 'agent-can-decide with no decision', verdict: { outcome: GapOutcome.AgentCanDecide, safeBecause: 'the standards settle it' } },
		{ label: 'agent-can-decide with no reason it is safe', verdict: { outcome: GapOutcome.AgentCanDecide, agentDecision: 'return null' } },
		{ label: 'already-answered with no citation', verdict: { outcome: GapOutcome.AlreadyAnswered } },
	])('$label is a rubber stamp, so the finding is unjudged', async ({ verdict }) => {
		const outcome = ruled({ humanDecision: undefined, ...verdict });

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe(`the judge answered ${verdict.outcome} without the evidence that outcome demands`);
	});

	test.each<{ label: string; answerAt: string }>([
		{ label: 'a file that exists under the repo root', answerAt: 'src/answer.ts' },
		{ label: 'a bare filename, which carries no directory and so is not a path token', answerAt: 'answer.ts' },
		{ label: 'a file:symbol citation, whose symbol half is never resolved', answerAt: 'answer.ts:noSuchExport' },
		{ label: 'a standards rule name, which is not a path at all', answerAt: 'single-use-scalar' },
		{ label: 'a plan line, which is not a path either', answerAt: 'Decision Log row 4' },
	])('an already-answered dismissal citing $label stands', async ({ answerAt }) => {
		const outcome = ruled({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, answerAt });

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.AlreadyAnswered);
		expect(judged[0]?.unjudgedReason).toBe(undefined);
	});

	test('an already-answered dismissal citing a file that is not on disk is unjudged', async () => {
		const outcome = ruled({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, answerAt: 'src/ghost.ts:answer' });

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [outcome] });

		// the citation is the only thing that makes a dismissal checkable — one
		// pointing nowhere is the rubber stamp this branch exists to catch
		expect(judged[0]?.outcome).toBe(GapOutcome.Unjudged);
		expect(judged[0]?.unjudgedReason).toBe('the judge cited src/ghost.ts:answer, which is not on disk');
	});

	test('an absolute citation is checked where it points rather than under the repo root', async () => {
		const { cwd } = await setupRepo();
		const outcome = ruled({ outcome: GapOutcome.AlreadyAnswered, humanDecision: undefined, answerAt: join(cwd, 'answer.ts') });

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [outcome] });

		expect(judged[0]?.outcome).toBe(GapOutcome.AlreadyAnswered);
	});

	test.each<{ outcome: typeof GapOutcome.NeedsAHuman | typeof GapOutcome.AgentCanDecide; verdict: Partial<GapVerdict> }>([
		{ outcome: GapOutcome.NeedsAHuman, verdict: { humanDecision: 'decide it', answerAt: 'src/ghost.ts' } },
		{
			outcome: GapOutcome.AgentCanDecide,
			verdict: { agentDecision: 'create it', safeBecause: 'the plan names the file', answerAt: 'src/ghost.ts' },
		},
	])('a $outcome verdict naming a path that does not exist yet is left alone', async ({ outcome, verdict }) => {
		// the file the plan is about to create is the normal case on these two
		// outcomes, so checking their citations would fail every one of them
		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps: [gapOf()], judgeOutcomes: [ruled({ outcome, humanDecision: undefined, ...verdict })] });

		expect(judged[0]?.outcome).toBe(outcome);
	});

	test('every finding comes back, in its own order, whichever judges answered', async () => {
		const gaps = [gapOf({ gap: 'first' }), gapOf({ gap: 'second' }), gapOf({ gap: 'third' })];
		const judgeOutcomes = [
			ruled(),
			undefined,
			ruled({ outcome: GapOutcome.AgentCanDecide, humanDecision: undefined, agentDecision: 'return null', safeBecause: 'the standards settle it' }),
		];

		const { cwd } = await setupRepo();

		const judged = await matchGapVerdicts({ cwd, gaps, judgeOutcomes });

		// building the result FROM the input is what makes it impossible for a
		// finding to disappear between the readers and the report
		expect(judged.map(({ gap, outcome }) => `${gap}/${outcome}`)).toStrictEqual(['first/needs-a-human', 'second/unjudged', 'third/agent-can-decide']);
	});
});
