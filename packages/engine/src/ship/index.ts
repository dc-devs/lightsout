export type { ShipIntent } from '#src/ship/common/types/ShipIntent.ts';
export type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
// The forge readers are published because they now serve two domains: ship's
// own resume path, and the queue's confirmation that a ticket already merged.
// `runGh` stays out, exactly as it stays out of the forge's own barrel.
export { findPullRequest, PullRequestState, type PullRequestSummary } from '#src/ship/forge/index.ts';
export { readBranchTicketRef } from '#src/ship/readBranchTicketRef.ts';
export { readShipResult } from '#src/ship/readShipResult.ts';
export { readTicketMatch } from '#src/ship/readTicketMatch.ts';
export { resolveShipIntent } from '#src/ship/resolveShipIntent.ts';
export { resolveShipSettings } from '#src/ship/resolveShipSettings.ts';
export { runShip } from '#src/ship/runShip.ts';
