// What the work order state has to say while work is actually happening: the terms
// one run of one plan may start and ship under, the progress recorded around
// that run, the build from the ticket body recorded on a work order holding no
// plan 001, and the record's say over the merge that follows. The commands that
// EDIT the record are the module's other half and stay beside this folder.
export { createWorkOrderShipGuard } from '#src/workOrder/implementRun/createWorkOrderShipGuard.ts';
export { readWorkOrderRunTerms } from '#src/workOrder/implementRun/readWorkOrderRunTerms.ts';
export { runWorkOrderBodyBuildLifecycle } from '#src/workOrder/implementRun/runWorkOrderBodyBuildLifecycle.ts';
export { runWorkOrderPlanLifecycle } from '#src/workOrder/implementRun/runWorkOrderPlanLifecycle.ts';
