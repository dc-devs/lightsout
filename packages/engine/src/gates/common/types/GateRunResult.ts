export interface GateRunResult {
	error: string | undefined;
	/** Gate kinds that failed on evidence about the code, for a fix agent. Never a crashed or timed-out gate. */
	failedFamilies: string[];
	/** One line per gate that crashed on every attempt. Non-empty only with `error`. */
	crashes: string[];
	/** One line per gate that ran past its ceiling on every attempt. Non-empty only with `error`. */
	timeouts: string[];
	/** Why the gate run never started: another run held the machine. Set with `error`; not evidence about the code. */
	coordination: string | undefined;
}
