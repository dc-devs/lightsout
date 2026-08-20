import { dim } from '#src/cli/common/terminal/dim.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';

interface Params {
	/** How this run names an opt-out: `declined`, `set aside`. */
	heading: string;
	batchId: string;
	/** The agent's own words, plus whatever the run wants attributed to it — one dim line each. */
	lines: string[];
	/** What the reader should do about it, printed last. */
	hint: string;
}

/**
 * The block a run prints for a batch its agent opted out of. The agent's
 * rationale is reproduced verbatim: a decline the reader cannot read is
 * indistinguishable from a run that quietly skipped work.
 */
export const printBatchOptOut = ({ heading, batchId, lines, hint }: Params): void => {
	console.log(`\n${yellow(heading)} ${batchId}`);

	for (const line of lines) {
		console.log(dim(`  ${line}`));
	}

	console.log(dim(`  ${hint}`));
};
