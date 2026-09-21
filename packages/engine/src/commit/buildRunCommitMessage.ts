interface Params {
	/** The subject line, already addressed — `<ticket> <plan-id>[/<phase-file-stem>]: <plan title>`, or the direct run's ticket heading. */
	subject: string;
	/** The lightsout run the commit came from, named in the body so any commit traces back to its run. */
	runId: string;
}

/**
 * The message one unit of work is committed under.
 *
 * The one place a run's commit message is assembled, so the two pipelines and
 * the queue's leftover-settling cannot drift apart on its shape. The subject is
 * passed through as given; the body names the run verbatim, which is what makes
 * a commit searchable back to the evidence behind it.
 */
export const buildRunCommitMessage = ({ subject, runId }: Params): string => `${subject}\n\nlightsout run ${runId}\n`;
