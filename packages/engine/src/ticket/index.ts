// `getTicketFolderPath`, `serializeTicketRecord`, `withTicketRecordLock`,
// `ticketFileNames` and `readTicketRecordFile` stay off this barrel: where the
// record lives, what bytes it takes and which lock guards it are this module's
// business, and a caller that could build the path could write the file without
// the contract and the lock the store applies. The operations' own helpers —
// how an event is appended, how a plan token is resolved, what a legacy entry
// is — stay off it for the same reason: a caller that could append an event
// could append one no operation ever decided on.

export { addTicketPlan } from '#src/ticket/addTicketPlan.ts';
export { adoptTicketPlan } from '#src/ticket/adoptTicketPlan.ts';
export { TicketSyncKeep } from '#src/ticket/common/constants/TicketSyncKeep.ts';
export type { TicketPlanOutcome } from '#src/ticket/common/types/TicketPlanOutcome.ts';
export type { TicketRecordChange } from '#src/ticket/common/types/TicketRecordChange.ts';
export type { TicketRunTerms } from '#src/ticket/common/types/TicketRunTerms.ts';
export type { TicketShipEligibility } from '#src/ticket/common/types/TicketShipEligibility.ts';
export { excludeTicketPlan } from '#src/ticket/excludeTicketPlan.ts';
export { findBareTicketFolderRefusal } from '#src/ticket/findBareTicketFolderRefusal.ts';
export { findNextPlanToPlan } from '#src/ticket/findNextPlanToPlan.ts';
export { findPlanImplementationBlocker } from '#src/ticket/findPlanImplementationBlocker.ts';
export { createTicketShipGuard, readTicketRunTerms, runTicketPlanLifecycle } from '#src/ticket/implementRun/index.ts';
export { publishTicketPlan } from '#src/ticket/publishTicketPlan.ts';
export { pullTicketRecord } from '#src/ticket/pullTicketRecord.ts';
export { readTicketRecord } from '#src/ticket/readTicketRecord.ts';
export { readTicketShipEligibility } from '#src/ticket/readTicketShipEligibility.ts';
export { requestTicketShip } from '#src/ticket/requestTicketShip.ts';
export { restoreTicketPlan } from '#src/ticket/restoreTicketPlan.ts';
export { retitleTicketPlan } from '#src/ticket/retitleTicketPlan.ts';
export { setTicketMode } from '#src/ticket/setTicketMode.ts';
export { syncTicketRecord } from '#src/ticket/syncTicketRecord.ts';
export { updateLocalTicketRecord } from '#src/ticket/updateLocalTicketRecord.ts';
export { updateSyncedTicketRecord } from '#src/ticket/updateSyncedTicketRecord.ts';
export { withdrawTicketShipRequest } from '#src/ticket/withdrawTicketShipRequest.ts';
