// `serializeWorkOrderState`, `withWorkOrderStateLock`, `workOrderFileNames` and
// `readWorkOrderStateFile` stay off this barrel: what bytes the state file takes
// and which lock guards it are this module's business, and a caller that could
// write the file without the contract and the lock the store applies would leave
// a state file no operation ever decided on. Where a work order's folder IS is
// not private — `workOrderFolderDir` is a workspace helper every module asks —
// because that folder is the address of a branch's ship and worktree records as
// well as its plans. The operations' own helpers — how an event is appended and
// how a plan token is resolved — stay off the barrel for the same reason the
// state file's bytes do.

export { addWorkOrderPlan } from '#src/workOrder/addWorkOrderPlan.ts';
export { WorkOrderSyncKeep } from '#src/workOrder/common/constants/WorkOrderSyncKeep.ts';
export type { WorkOrderPlanOutcome } from '#src/workOrder/common/types/WorkOrderPlanOutcome.ts';
export type { WorkOrderRunTerms } from '#src/workOrder/common/types/WorkOrderRunTerms.ts';
export type { WorkOrderShipEligibility } from '#src/workOrder/common/types/WorkOrderShipEligibility.ts';
export type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';
export { excludeWorkOrderPlan } from '#src/workOrder/excludeWorkOrderPlan.ts';
export { findNextPlanToPlan } from '#src/workOrder/findNextPlanToPlan.ts';
export { findPlanImplementationBlocker } from '#src/workOrder/findPlanImplementationBlocker.ts';
export { createWorkOrderShipGuard, readWorkOrderRunTerms, runWorkOrderPlanLifecycle } from '#src/workOrder/implementRun/index.ts';
export { publishWorkOrderPlan } from '#src/workOrder/publishWorkOrderPlan.ts';
export { pullWorkOrderState } from '#src/workOrder/pullWorkOrderState.ts';
export { readWorkOrderShipEligibility } from '#src/workOrder/readWorkOrderShipEligibility.ts';
export { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';
export { requestWorkOrderShip } from '#src/workOrder/requestWorkOrderShip.ts';
export { restoreWorkOrderPlan } from '#src/workOrder/restoreWorkOrderPlan.ts';
export { retitleWorkOrderPlan } from '#src/workOrder/retitleWorkOrderPlan.ts';
export { setWorkOrderMode } from '#src/workOrder/setWorkOrderMode.ts';
export { syncWorkOrderState } from '#src/workOrder/syncWorkOrderState.ts';
export { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
export { updateSyncedWorkOrderState } from '#src/workOrder/updateSyncedWorkOrderState.ts';
export { withdrawWorkOrderShipRequest } from '#src/workOrder/withdrawWorkOrderShipRequest.ts';
