import { RunStatus } from '#src/contracts/index.ts';

export const statusIcons: Record<string, string> = {
	[RunStatus.Passed]: '✓',
	[RunStatus.Failed]: '✗',
	[RunStatus.Running]: '…',
	[RunStatus.Pending]: '○',
	[RunStatus.PausedRateLimit]: '⏸',
	[RunStatus.Escalated]: '⚑',
};
