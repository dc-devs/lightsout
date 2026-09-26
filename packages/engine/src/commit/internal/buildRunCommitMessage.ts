interface Params {
	/** The subject line, already addressed. */
	subject: string;
	/** The agent's body, placed between the subject and the trailer lines. Blank or whitespace-only is treated as absent. */
	body?: string;
	/** The plan unit named on a `lightsout plan <unit>` trailer line. */
	unit?: string;
	/** The lightsout run named on the `lightsout run <runId>` trailer line. */
	runId?: string;
}

/**
 * The message one unit of work is committed under.
 *
 * The one place a commit message is assembled, so every commit point carries
 * the same shape. The subject is passed through as the composer settled on it —
 * the agent's summary behind the ticket reference, or the caller's template
 * subject. The trailer lines name the plan unit, when the commit belongs to
 * one, and then the run verbatim, which is what makes a commit searchable back
 * to the evidence behind it.
 */
export const buildRunCommitMessage = ({ subject, body, unit, runId }: Params): string => {
	const prose = body?.trim() ?? '';
	const trailers = [...(unit === undefined ? [] : [`lightsout plan ${unit}`]), ...(runId === undefined ? [] : [`lightsout run ${runId}`])];
	const paragraphs = [subject, ...(prose === '' ? [] : [prose]), ...(trailers.length === 0 ? [] : [trailers.join('\n')])];

	return `${paragraphs.join('\n\n')}\n`;
};
