interface Params {
	/** The holder phrase `describeGateLockHolder` writes — the run, its worktree and how long it has held the machine. */
	holder: string;
	waitedMs: number;
}

/**
 * The one sentence a gate run that never started because it could not have the
 * machine is reported with.
 *
 * Written once, following the rule `describeGateCrash` established: one event
 * gets one spelling, so the expiry reads the same wherever it surfaces. It must
 * not read as a code failure and must not suggest a repair — no gate command
 * executed, so there is nothing about the code to have failed.
 */
export const describeGateCoordinationTimeout = ({ holder, waitedMs }: Params): string => {
	const waited = waitedMs >= 60_000 ? `${Math.round(waitedMs / 60_000)}m` : `${Math.round(waitedMs / 1_000)}s`;

	return `gates never started: this run waited ${waited} for another gate run on this machine to finish, and the machine is still taken by ${holder}. No gate command executed, so nothing here is evidence about the code — the worktree and every commit in it are exactly as they were. Wait for the holder to finish, or find out why it has not.`;
};
