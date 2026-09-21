// `serializeTicketRecord`, `withTicketRecordLock`, `ticketFileNames` and
// `readTicketRecordFile` stay off this barrel: what bytes the record takes and
// which lock guards it are this module's business, and a caller that could
// write the file without the contract and the lock the store applies would
// leave a record no operation ever decided on. Where the ticket's folder IS is
// not private — `ticketFolderDir` is a workspace helper every module asks —
// because that folder is the address of a branch's ship and worktree records
// as well as its plans. The operations' own helpers — how an event is appended,
// how a plan token is resolved, what a plans folder's loose files are — stay off
// the barrel for the same reason the record's bytes do.

export { addTicketPlan } from '#src/ticket/addTicketPlan.ts';
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
