interface Params {
	/** The engine's rendered evidence brief for this assignment. */
	brief: string;
}

/**
 * The collected-evidence section: the engine's brief under a heading of its own,
 * plus the contract that says how far it goes.
 *
 * The brief is inlined verbatim. Paraphrasing or truncating it would send the
 * writer back to the files the engine read for it, which is the repeated
 * retrieval this role exists to remove.
 */
export const evidenceSection = ({ brief }: Params): string =>
	`## Collected source evidence

The engine read the files this assignment touches and collected the evidence
below from them, once for the whole draft. It stands in place of your re-reading
them: start here rather than opening a file this section already covers.

You still have file tools, and this is not the limit of what you may look at.
Open anything the evidence does not answer. Where what you find and what your
inputs state cannot be reconciled, report the discrepancy and stop the draft —
never resolve it with a guess.

${brief}`;
