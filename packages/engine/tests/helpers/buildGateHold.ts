import type { GateHold } from '#src/contracts/gates/GateHold.ts';

/** One ticket's hold, as a coordination timeout writes it before the tracker has confirmed anything. */
export const buildGateHold = ({ runId }: { runId: string }): GateHold => ({
	takenAt: '2026-09-08T10:00:00.000Z',
	runId,
	worktreePath: `/repo/.worktrees/${runId}`,
	reason: 'The gates never got the machine within the wait ceiling.',
	labelConfirmed: false,
});
