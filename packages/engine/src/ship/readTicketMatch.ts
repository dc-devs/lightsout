interface Params {
	branch: string;
	ticketPattern: RegExp;
}

/**
 * The branch's ticket capture groups, or undefined when the branch does not
 * carry one.
 *
 * The `ticket` entry becomes the result's `ticketRef`; the whole record is what
 * the pull request body template substitutes from, which is how a house
 * convention like `lo-60` can also yield a bare `60` without the engine
 * learning either spelling. A group that did not capture is dropped rather than
 * carried as undefined, so a template naming it is left visibly unsubstituted.
 */
export const readTicketMatch = ({ branch, ticketPattern }: Params): Record<string, string> | undefined => {
	const groups = ticketPattern.exec(branch)?.groups;
	const captured = Object.entries(groups ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined);

	return captured.some(([name]) => name === 'ticket') ? Object.fromEntries(captured) : undefined;
};
