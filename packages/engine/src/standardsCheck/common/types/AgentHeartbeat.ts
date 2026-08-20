export interface AgentHeartbeat {
	/** Relay to the driver's event stream; counts the files the agent has read so each line carries proof of life, not just elapsed time. */
	onEvent: (event: unknown) => void;
	/** Ends the ticker. */
	stop: () => void;
	/** How long the agent has run — frozen at the moment of `stop`, so the closing line reports the run, not the reporting. */
	elapsedMs: () => number;
}
