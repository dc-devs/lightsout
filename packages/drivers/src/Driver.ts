import type { DriverInvocation } from './DriverInvocation';
import type { DriverResult } from './DriverResult';

/**
 * The harness boundary. A driver spawns the user's own installed coding agent
 * (Claude Code, Codex, ...) and returns its final output.
 *
 * Hard rule: drivers NEVER handle model credentials. Each harness brings its
 * own auth — which is also what keeps usage on the user's existing
 * subscription instead of pay-per-token API billing.
 */
export interface Driver {
	name: string;
	invoke: (invocation: DriverInvocation) => Promise<DriverResult>;
}
