interface Params {
	/** The verification step whose gates never started. */
	stepId: string;
	/** The coordination reason `runGates` answered with — who holds the machine, in which worktree, and for how long it has held it. */
	coordination: string;
}

/**
 * What an operator is told when a step's gates never started, because another
 * gate run of this repository held the machine for longer than the wait allows.
 *
 * Written once because two pipelines end on this condition — the implement
 * pipeline's verification steps and the direct run's verify — and they end it
 * through different run types. Only the sentences are shared: were each to spell
 * its own, an edit to one would leave the two telling an operator something
 * different about the same machine.
 *
 * Callers append whatever gate output arrived beside the reason, which is
 * evidence a human reads rather than part of this promise.
 */
export const describeGateCoordinationStop = ({ stepId, coordination }: Params): string =>
	[
		`${stepId}: the gates never started — another gate run of this repository held the machine, so nothing here was judged.`,
		'No fix was attempted and no fix attempt was spent. The worktree and every commit in it are untouched, so this work resumes where it stopped once the machine is free.',
		coordination,
	].join('\n\n');
