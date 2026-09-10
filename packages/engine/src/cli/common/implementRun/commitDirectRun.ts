import { headingOf } from '#src/common/utils/headingOf.ts';
import { commitTicketWork } from '#src/queue/index.ts';

interface Params {
	/** The checkout holding the work — the run's workspace when it was isolated. */
	cwd: string;
	/** The frozen ticket body; its first heading becomes the commit subject. */
	ticketBody: string;
	ticketRef: string;
	/** The run directory the commit message file is written into, in the checkout the run's records live in. */
	runDir: string;
	/** The config's `generated` path prefixes, forwarded unchanged. */
	generated: string[] | undefined;
	onProgress: (message: string) => void;
}

/**
 * The commit a passed direct run ends on — which is what makes `--ship` and
 * `ship.after-implement` work at all — or the sentence saying why there is none.
 *
 * A run that produced no commit must never chain into ship, so "the worker
 * changed nothing" is a refusal here rather than a quiet success.
 *
 * It takes the run directory rather than a run id: the checkout holding the
 * work and the checkout holding the run's records are no longer the same
 * directory, so deriving the run directory from `cwd` would write the message
 * file into the wrong tree.
 *
 * @returns undefined when the work is committed, or the one sentence saying why it is not
 */
export const commitDirectRun = async ({ cwd, ticketBody, ticketRef, runDir, generated, onProgress }: Params): Promise<string | undefined> => {
	const subject = headingOf({ text: ticketBody });
	const committed = await commitTicketWork({
		cwd,
		message: `${ticketRef} ${subject}`.trim(),
		runDir,
		generated,
		onProgress,
	});

	if ('error' in committed) {
		return committed.error;
	}

	return committed.committed ? undefined : 'the worker changed nothing';
};
