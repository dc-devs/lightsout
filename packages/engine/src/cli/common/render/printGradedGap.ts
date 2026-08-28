import { dim } from '#src/cli/common/terminal/dim.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import { isBlockingGap } from '#src/plan/index.ts';

interface Params {
	gap: GradedGap;
	/** Where the two lines go — stdout by default. */
	write?: (line: string) => void;
}

/** The second line, chosen by the judge's answer: what the human must decide, what the agent would decide, where the answer already is, or why nobody weighed it. */
const detailOf = ({ gap }: { gap: GradedGap }) => {
	const lines: Record<GapOutcome, string> = {
		[GapOutcome.NeedsAHuman]: `   decide: ${gap.humanDecision ?? gap.decision}${gap.options.length > 0 ? ` — options: ${gap.options.join(' / ')}` : ''}`,
		[GapOutcome.AgentCanDecide]: `   the agent decides: ${gap.agentDecision ?? ''} — safe because ${gap.safeBecause ?? ''}`,
		[GapOutcome.AlreadyAnswered]: `   already answered at: ${gap.answerAt ?? ''}`,
		[GapOutcome.Unjudged]: `   unjudged, so it blocks: ${gap.unjudgedReason ?? 'no judge settled this finding'}`,
	};

	return lines[gap.outcome];
};

/**
 * Render one judged gap: the `?` marker when it gates the grade, a dim `note`
 * when it does not, then the area, the finding and the lens that found it, with
 * the judge's own evidence on the following dim line.
 *
 * This is a renderer, not a filter — it prints every outcome, and which gaps it
 * is handed is the caller's decision. Keeping it total means the note lines are
 * ready the day something wants to show them.
 */
export const printGradedGap = ({ gap, write = console.log }: Params): void => {
	const marker = isBlockingGap({ gap }) ? yellow('?') : dim('note');

	write(`${marker} [${gap.area}] ${gap.gap} ${dim(`(${gap.lens})`)}`);
	write(dim(detailOf({ gap })));
};
