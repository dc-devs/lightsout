interface Params {
	cwd: string;
	/** The live run's id — the only parameter the command takes, since everything else is read from that run's manifest. */
	runId: string;
}

/**
 * The engine's own self-check as both the full command a writing agent is given
 * and the prefix the harness is asked to allow.
 *
 * The agent checks its change where its context is already loaded — a repair
 * spawn re-reads everything it already knew. `process.argv[1]` is the running
 * CLI bundle, so the agent's subprocess resolves the identical engine rather
 * than whatever happens to be installed. The consumer-controlled `cwd` is quoted
 * because it may contain spaces; the prefix stays unquoted in both the command
 * and the grant, because the harness's allowed-tools rule is a literal prefix
 * match.
 */
export const buildSelfCheckCommand = ({ cwd, runId }: Params): { prefix: string; command: string } => {
	const prefix = `node ${process.argv[1]} self-check`;

	return { prefix, command: `${prefix} --run ${runId} --cwd "${cwd}"` };
};
