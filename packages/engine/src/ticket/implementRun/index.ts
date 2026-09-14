// What the ticket record has to say while work is actually happening: the terms
// one run of one plan may start and ship under, the progress recorded around
// that run, and the record's say over the merge that follows. The commands that
// EDIT the record are the module's other half and stay beside this folder.
export { createTicketShipGuard } from '#src/ticket/implementRun/createTicketShipGuard.ts';
export { readTicketRunTerms } from '#src/ticket/implementRun/readTicketRunTerms.ts';
export { runTicketPlanLifecycle } from '#src/ticket/implementRun/runTicketPlanLifecycle.ts';
