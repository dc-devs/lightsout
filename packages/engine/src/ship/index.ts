export type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
export type { ShipIntent } from '#src/ship/common/types/ShipIntent.ts';
export type { ShipRequestTerms } from '#src/ship/common/types/ShipRequestTerms.ts';
export type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
export type { ShipWorkOrderGuard } from '#src/ship/common/types/ShipWorkOrderGuard.ts';
// `getShipResultPath` stays off this barrel, for the reason
// `queue/branchState/index.ts` gives about `getBranchStatePath`: the record's
// location is this module's business, and a caller that can build the path can
// write the file without the contract the writer applies.
//
// The forge readers are published because they now serve two domains: ship's
// own resume path, and the queue's confirmation that a ticket already merged.
// `runGh` stays out, exactly as it stays out of the forge's own barrel.
export { findPullRequest, PullRequestState, type PullRequestSummary } from '#src/ship/forge/index.ts';
// `readTicketMatch` stays off this barrel, and `matchesTicketPattern` narrows
// it in its place. The match answers the capture groups a pull request body
// substitutes from, and handing those out is how one piece of work came to have
// several authors for its name; whether a branch carries a ticket at all is the
// whole of what a caller outside ship may legitimately ask.
export { matchesTicketPattern } from '#src/ship/matchesTicketPattern.ts';
// The shipping record's reader is published for the CLI's shipping block; its
// recorder is not, because only this module's own sequence writes the record.
export { readShippingProgress, type ShippingProgressReading } from '#src/ship/progress/index.ts';
export { readShipResult } from '#src/ship/readShipResult.ts';
export { resolveShipIntent } from '#src/ship/resolveShipIntent.ts';
export { resolveShipSettings } from '#src/ship/resolveShipSettings.ts';
export { runShip } from '#src/ship/runShip.ts';
