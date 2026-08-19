import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';
import { RunStatus, type StepRecord } from '@/contracts';

interface Params {
	step: StepRecord;
	/** The agent's own opt-out on this batch — a refactor decline, a set-aside coverage file. */
	optedOut: boolean;
	/** What became of the batch, in the run's own vocabulary. */
	label: string;
}

/**
 * One batch's line in a run report: outcome icon, the batch id in a fixed
 * column, what became of it, and how many files it touched.
 *
 * An opt-out is not a failure — the agent looked and said no — so it gets its
 * own icon rather than the red one a genuinely failed step earns.
 */
export const printBatchLine = ({ step, optedOut, label }: Params): void => {
	const icon = step.status !== RunStatus.Passed ? red('✗') : optedOut ? yellow('⤫') : green('✓');

	console.log(`${icon} ${step.id.padEnd(48)}${label}${step.changedFiles?.length ? dim(` · ${step.changedFiles.length} file(s)`) : ''}`);
};
