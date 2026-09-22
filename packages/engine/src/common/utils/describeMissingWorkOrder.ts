interface Params {
	/** The work order folder's label — the name every command addresses it by. */
	name: string;
}

/**
 * The one sentence a command answers with when the work order it was asked
 * about has no state file at all.
 *
 * A work order with no state is one nobody has started, and the command named
 * is how one is started. It lives here rather than in the work order module
 * because `lightsout work-order show` reads a state file the change operations
 * may not touch and so cannot reach the sentence through them — and two
 * spellings of one refusal would soon name different commands.
 */
export const describeMissingWorkOrder = ({ name }: Params): string =>
	`there is no work order called '${name}' — start one with \`lightsout work-order add-plan --name ${name} --slug <slug>\``;
