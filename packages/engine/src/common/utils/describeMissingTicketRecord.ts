interface Params {
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
}

/**
 * The one sentence a command answers with when the ticket it was asked about
 * has no record at all.
 *
 * A ticket with no record is either one nobody has started or a folder shaped
 * before ticket records existed, and the two commands named are the way out of
 * each. It lives here rather than in the ticket module because `lightsout
 * ticket show` reads a record the change operations may not touch and so cannot
 * reach the sentence through them — and two spellings of one refusal would soon
 * name different commands.
 */
export const describeMissingTicketRecord = ({ ticketBranch }: Params): string =>
	`there is no ticket record for '${ticketBranch}' — start one with \`lightsout ticket add-plan --name ${ticketBranch} --slug <slug>\`, or turn a folder shaped before ticket records into plan 001 with \`lightsout ticket adopt --name ${ticketBranch} --slug <slug>\``;
