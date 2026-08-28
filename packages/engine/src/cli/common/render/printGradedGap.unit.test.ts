import { expect, test } from '@jest/globals';
import { printGradedGap } from '#src/cli/common/render/printGradedGap.ts';
import { GapArea, GapCheckLens, GapOutcome, type GradedGap } from '#src/contracts/index.ts';

// The gap's whole output IS its two lines, so capturing the writer is the
// arrangement. isTTY is pinned off so the assertions read the plain text a piped
// consumer sees.
const setupGradedGap = ({ gap = {} }: { gap?: Partial<GradedGap> } = {}) => {
	const logged: string[] = [];

	process.stdout.isTTY = false;

	const entry: GradedGap = {
		area: GapArea.OmittedDecision,
		gap: 'the plan picks no failure mode',
		decision: 'what to return when the judge times out',
		options: [],
		phase: 'plan.md',
		lens: GapCheckLens.Decisions,
		outcome: GapOutcome.NeedsAHuman,
		...gap,
	};

	return { gap: entry, logged, write: (line: string) => logged.push(line) };
};

test('printGradedGap: a finding a human must settle wears the question marker and names the decision', () => {
	const { gap, logged, write } = setupGradedGap({ gap: { humanDecision: 'pick the failure mode', options: ['throw', 'return null'] } });

	printGradedGap({ gap, write });

	expect(logged).toStrictEqual([
		'? [omitted-decision] the plan picks no failure mode (decisions)',
		'   decide: pick the failure mode — options: throw / return null',
	]);
});

test("printGradedGap: without the judge's own wording the reader's decision line stands in", () => {
	const { gap, logged, write } = setupGradedGap();

	printGradedGap({ gap, write });

	expect(logged[1]).toBe('   decide: what to return when the judge times out');
});

test('printGradedGap: a finding the implementing agent can settle is a note, and says what it would decide', () => {
	const { gap, logged, write } = setupGradedGap({
		gap: { outcome: GapOutcome.AgentCanDecide, agentDecision: 'return null', safeBecause: 'every sibling in this module already does' },
	});

	printGradedGap({ gap, write });

	// a note gates nothing, so it must not wear the marker a blocking finding does
	expect(logged).toStrictEqual([
		'note [omitted-decision] the plan picks no failure mode (decisions)',
		'   the agent decides: return null — safe because every sibling in this module already does',
	]);
});

test('printGradedGap: a finding the reader missed an answer for points at where the answer lives', () => {
	const { gap, logged, write } = setupGradedGap({ gap: { outcome: GapOutcome.AlreadyAnswered, answerAt: 'src/plan/runPlanGrade.ts:foldGapResults' } });

	printGradedGap({ gap, write });

	expect(logged[0]?.startsWith('note ')).toBe(true);
	expect(logged[1]).toBe('   already answered at: src/plan/runPlanGrade.ts:foldGapResults');
});

test('printGradedGap: a finding nobody judged says so, and why, rather than reading like a thin plan', () => {
	const { gap, logged, write } = setupGradedGap({ gap: { outcome: GapOutcome.Unjudged, unjudgedReason: 'the judge was rate limited or overloaded' } });

	printGradedGap({ gap, write });

	// the two kinds of blocking finding are different questions, and the line
	// says which one this is
	expect(logged).toStrictEqual([
		'? [omitted-decision] the plan picks no failure mode (decisions)',
		'   unjudged, so it blocks: the judge was rate limited or overloaded',
	]);
});

test('printGradedGap: an unjudged finding with no recorded reason still says nobody settled it', () => {
	const { gap, logged, write } = setupGradedGap({ gap: { outcome: GapOutcome.Unjudged } });

	printGradedGap({ gap, write });

	expect(logged[1]).toBe('   unjudged, so it blocks: no judge settled this finding');
});

test('printGradedGap: an agent-can-decide finding missing its evidence still renders both lines', () => {
	const { gap, logged, write } = setupGradedGap({ gap: { outcome: GapOutcome.AgentCanDecide } });

	printGradedGap({ gap, write });

	// the renderer is total: a half-filled record prints rather than throwing
	expect(logged[1]).toBe('   the agent decides:  — safe because ');
});

test('printGradedGap: an already-answered finding missing its citation still renders both lines', () => {
	const { gap, logged, write } = setupGradedGap({ gap: { outcome: GapOutcome.AlreadyAnswered } });

	printGradedGap({ gap, write });

	expect(logged[1]).toBe('   already answered at: ');
});

test('printGradedGap: on a TTY the blocking marker is yellow and the detail line is dim', () => {
	const { gap, logged, write } = setupGradedGap({ gap: { humanDecision: 'pick the failure mode' } });

	process.stdout.isTTY = true;

	printGradedGap({ gap, write });

	expect(logged).toStrictEqual([
		'\u001b[33m?\u001b[0m [omitted-decision] the plan picks no failure mode \u001b[2m(decisions)\u001b[0m',
		'\u001b[2m   decide: pick the failure mode\u001b[0m',
	]);
});

test('printGradedGap: the two lines go to stdout when no writer is given', () => {
	const { gap } = setupGradedGap();
	const logged: string[] = [];
	const original = console.log;

	console.log = (...args: unknown[]) => logged.push(String(args[0]));

	try {
		printGradedGap({ gap });
	} finally {
		console.log = original;
	}

	expect(logged.length).toBe(2);
});
