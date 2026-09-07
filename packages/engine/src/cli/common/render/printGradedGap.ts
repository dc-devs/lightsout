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
		// The refusal note rides this line because a needs-a-human gap is where an
		// open memory record arrives, and a stored reason nobody prints does not tell
		// anyone why the re-verification judge declined to close it.
		[GapOutcome.NeedsAHuman]: `   decide: ${gap.humanDecision ?? gap.decision}${gap.options.length > 0 ? ` — options: ${gap.options.join(' / ')}` : ''}${gap.unjudgedReason === undefined ? '' : ` — ${gap.unjudgedReason}`}`,
		[GapOutcome.AgentCanDecide]: `   the agent decides: ${gap.agentDecision ?? ''} — safe because ${gap.safeBecause ?? ''}`,
		[GapOutcome.AlreadyAnswered]: `   already answered at: ${gap.answerAt ?? ''}`,
		[GapOutcome.Unjudged]: `   unjudged, so it blocks: ${gap.unjudgedReason ?? 'no judge settled this finding'}`,
	};

	return lines[gap.outcome];
};

/**
 * Render one judged gap: the memory record id when it has one, the `?` marker
 * when it gates the grade or a dim `note` when it does not, then the area, the
 * finding and — when a per-file lens found it — that lens, with the judge's own
 * evidence on the following dim line.
 *
 * This is a renderer, not a filter — it prints every outcome, and which gaps it
 * is handed is the caller's decision. Keeping it total means the note lines are
 * ready the day something wants to show them.
 */
export const printGradedGap = ({ gap, write = console.log }: Params): void => {
	const marker = isBlockingGap({ gap }) ? yellow('?') : dim('note');

	// The whole-plan documentation checker carries no lens, and an empty `()` would
	// read as a lens the renderer failed to print.
	const source = gap.lens === undefined ? '' : ` ${dim(`(${gap.lens})`)}`;
	// The record id when the memory carried this finding across passes: it is how a
	// human tells a finding the plan has seen before from a fresh one, and how they
	// name it when talking about what is on record.
	const record = gap.findingId === undefined ? '' : `${dim(gap.findingId)} `;

	write(`${record}${marker} [${gap.area}] ${gap.gap}${source}`);
	write(dim(detailOf({ gap })));
};
