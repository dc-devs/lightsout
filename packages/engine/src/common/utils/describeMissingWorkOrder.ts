interface Params {
	/** The work order folder's label, which is also the branch its plans implement on. */
	name: string;
}

/**
 * The one sentence a command answers with when the work order it was asked
 * about has no state file at all.
 *
 * A work order with no state is either one nobody has started or one whose
 * plans folder already holds loose files, and the one command named starts a
 * plan either way — its `--from` form naming the folder those files are in. It
 * lives here rather than in the work order module because
 * `lightsout work-order show` reads a state file the change operations may not
 * touch and so cannot reach the sentence through them — and two spellings of
 * one refusal would soon name different commands.
 */
export const describeMissingWorkOrder = ({ name }: Params): string =>
	`there is no work order called '${name}' — start one with \`lightsout work-order add-plan --name ${name} --slug <slug>\`, adding \`--from ${name}\` when that folder already holds the loose files the plan is to be made out of`;
