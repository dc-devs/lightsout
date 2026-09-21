interface Params {
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
}

/**
 * The one sentence a command answers with when the ticket it was asked about
 * has no record at all.
 *
 * A ticket with no record is either one nobody has started or one whose plans
 * folder already holds loose files, and the one command named starts a plan
 * either way — its `--from` form naming the folder those files are in. It lives
 * here rather than in the ticket module because `lightsout work-order show` reads a
 * record the change operations may not touch and so cannot reach the sentence
 * through them — and two spellings of one refusal would soon name different
 * commands.
 */
export const describeMissingTicketRecord = ({ ticketBranch }: Params): string =>
	`there is no ticket record for '${ticketBranch}' — start one with \`lightsout work-order add-plan --name ${ticketBranch} --slug <slug>\`, adding \`--from ${ticketBranch}\` when that folder already holds the loose files the plan is to be made out of`;
