// `serializeWorkOrderState`, `withWorkOrderStateLock`, `workOrderFileNames` and
// `readWorkOrderStateFile` stay off this barrel: what bytes the state file takes
// and which lock guards it are this module's business, and a caller that could
// write the file without the contract and the lock the store applies would leave
// a state file no operation ever decided on. Where a work order's folder IS is
// not private — `workOrderFolderDir` is a workspace helper every module asks —
// because that folder is the address of a branch's ship and worktree records as
// well as its plans. The operations' own helpers — how an event is appended and
// how a plan token is resolved — stay off the barrel for the same reason the
// state file's bytes do — and so do the three helpers behind `createWorkOrder`:
// how a label is composed, where its words come from and how a ticket's title
// is read are the module's business, and a caller that could compose a label
// could write one without the lock the creator takes.

export { addWorkOrderPlan } from '#src/workOrder/addWorkOrderPlan.ts';
export { WorkOrderSyncKeep } from '#src/workOrder/common/constants/WorkOrderSyncKeep.ts';
export type { WorkOrderListing } from '#src/workOrder/common/types/WorkOrderListing.ts';
export type { WorkOrderPlanOutcome } from '#src/workOrder/common/types/WorkOrderPlanOutcome.ts';
export type { WorkOrderRunTerms } from '#src/workOrder/common/types/WorkOrderRunTerms.ts';
export type { WorkOrderShipEligibility } from '#src/workOrder/common/types/WorkOrderShipEligibility.ts';
export type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';
export { createWorkOrder } from '#src/workOrder/createWorkOrder.ts';
export { excludeWorkOrderPlan } from '#src/workOrder/excludeWorkOrderPlan.ts';
export { findNextPlanToPlan } from '#src/workOrder/findNextPlanToPlan.ts';
export { findPlanImplementationBlocker } from '#src/workOrder/findPlanImplementationBlocker.ts';
export { findWorkOrderByTicketRef } from '#src/workOrder/findWorkOrderByTicketRef.ts';
export {
	createWorkOrderShipGuard,
	readWorkOrderRunTerms,
	runWorkOrderBodyBuildLifecycle,
	runWorkOrderPlanLifecycle,
} from '#src/workOrder/implementRun/index.ts';
export { isPlanlessWorkOrder } from '#src/workOrder/isPlanlessWorkOrder.ts';
export { listWorkOrders } from '#src/workOrder/listWorkOrders.ts';
export { publishWorkOrderPlan } from '#src/workOrder/publishWorkOrderPlan.ts';
export { pullWorkOrderState } from '#src/workOrder/pullWorkOrderState.ts';
export { readWorkOrderShipEligibility } from '#src/workOrder/readWorkOrderShipEligibility.ts';
export { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';
export { readWorkOrderTicketRef } from '#src/workOrder/readWorkOrderTicketRef.ts';
export { requestWorkOrderShip } from '#src/workOrder/requestWorkOrderShip.ts';
export { restoreWorkOrderPlan } from '#src/workOrder/restoreWorkOrderPlan.ts';
export { retitleWorkOrderPlan } from '#src/workOrder/retitleWorkOrderPlan.ts';
export { setWorkOrderMode } from '#src/workOrder/setWorkOrderMode.ts';
export { syncWorkOrderState } from '#src/workOrder/syncWorkOrderState.ts';
export { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
export { updateSyncedWorkOrderState } from '#src/workOrder/updateSyncedWorkOrderState.ts';
export { withdrawWorkOrderShipRequest } from '#src/workOrder/withdrawWorkOrderShipRequest.ts';
