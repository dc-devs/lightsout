import type { DriverInvocation } from '@/drivers/common/types/DriverInvocation';
import type { DriverResult } from '@/drivers/common/types/DriverResult';

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
