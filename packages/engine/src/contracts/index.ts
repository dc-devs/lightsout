// Re-exported from the shared package rather than declared here. These are the
// shapes a standards pack implements, so they belong to something a pack
// author can install — the engine is one consumer of them among others, not
// their owner. Listing them here keeps the engine's published `./contracts`
// entry complete for its consumers; engine code itself imports each one from
// `@lightsout/standards-contracts`, the package that declares it.
export type {
	CloneSpan,
	CloneSpansInput,
	FileListInput,
	FileTextInput,
	ImportGraphInput,
	StandardsCheckFunction,
	StandardsCheckInput,
	SyntaxTreeInput,
	TestFileInput,
	TypeCheckerInput,
} from '@lightsout/standards-contracts';
export {
	RawStandardsFinding,
	StandardsCheckModule,
	StandardsInputKind,
	StandardsPackRoot,
	StandardsSet,
} from '@lightsout/standards-contracts';
export { ActivityLevelEnd } from '#src/contracts/activity/ActivityLevelEnd.ts';
export { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
export { ActivityLevelStart } from '#src/contracts/activity/ActivityLevelStart.ts';
export { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
export { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
export { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
export { ActivityReport } from '#src/contracts/activity/ActivityReport.ts';
export { ActivityTotals } from '#src/contracts/activity/ActivityTotals.ts';
export { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
export { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';
export { ProcessEndReason } from '#src/contracts/activity/ProcessEndReason.ts';
export { ConfigAutoPlan } from '#src/contracts/ConfigAutoPlan.ts';
export { ConfigCommands } from '#src/contracts/ConfigCommands.ts';
export { ConfigDocs } from '#src/contracts/ConfigDocs.ts';
export { ConfigGates } from '#src/contracts/ConfigGates.ts';
export { ConfigImplement } from '#src/contracts/ConfigImplement.ts';
export { ConfigPlan } from '#src/contracts/ConfigPlan.ts';
export { ConfigPricing } from '#src/contracts/ConfigPricing.ts';
export { ConfigQueue } from '#src/contracts/ConfigQueue.ts';
export { ConfigShip } from '#src/contracts/ConfigShip.ts';
export { ConfigTicketTracker } from '#src/contracts/ConfigTicketTracker.ts';
export { ConfigWorktree } from '#src/contracts/ConfigWorktree.ts';
export { CommandActor } from '#src/contracts/commands/CommandActor.ts';
export { CommandCatalogEntry } from '#src/contracts/commands/CommandCatalogEntry.ts';
export { CommandFlag } from '#src/contracts/commands/CommandFlag.ts';
export { CommandGroup } from '#src/contracts/commands/CommandGroup.ts';
export { CommandInvocation } from '#src/contracts/commands/CommandInvocation.ts';
export { CommandRecordKind } from '#src/contracts/commands/CommandRecordKind.ts';
export { CommandStep } from '#src/contracts/commands/CommandStep.ts';
export { CoverageBatchReport } from '#src/contracts/coverage/CoverageBatchReport.ts';
export { CoverageFile } from '#src/contracts/coverage/CoverageFile.ts';
export { CoverageTotal } from '#src/contracts/coverage/CoverageTotal.ts';
export { CoverageWorklist } from '#src/contracts/coverage/CoverageWorklist.ts';
export { DedupFinding } from '#src/contracts/dedup/DedupFinding.ts';
export { DedupJudgment } from '#src/contracts/dedup/DedupJudgment.ts';
export { DedupReport } from '#src/contracts/dedup/DedupReport.ts';
export { DedupResolution } from '#src/contracts/dedup/DedupResolution.ts';
export { DedupVerdict } from '#src/contracts/dedup/DedupVerdict.ts';
export { ReviewedCollision } from '#src/contracts/dedup/ReviewedCollision.ts';
export { Effort } from '#src/contracts/Effort.ts';
export { FrictionArea } from '#src/contracts/friction/FrictionArea.ts';
export { FrictionEntry } from '#src/contracts/friction/FrictionEntry.ts';
export { FrictionRecord } from '#src/contracts/friction/FrictionRecord.ts';
export { GateOverride } from '#src/contracts/GateOverride.ts';
export { GateOverrides } from '#src/contracts/GateOverrides.ts';
export { GateHold } from '#src/contracts/gates/GateHold.ts';
export { GateLock } from '#src/contracts/gates/GateLock.ts';
export { GateResult } from '#src/contracts/gates/GateResult.ts';
export { TestCaseStatus } from '#src/contracts/gates/TestCaseStatus.ts';
export { TestResultsFile } from '#src/contracts/gates/TestResultsFile.ts';
export { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
export { PackageGates } from '#src/contracts/PackageGates.ts';
export { Permissions } from '#src/contracts/Permissions.ts';
export { BrainstormDecisions } from '#src/contracts/plan/decisions/BrainstormDecisions.ts';
export { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
export { DecisionSource } from '#src/contracts/plan/decisions/DecisionSource.ts';
export { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
export { DraftImplementation } from '#src/contracts/plan/draft/DraftImplementation.ts';
export { PlanDraftReport } from '#src/contracts/plan/draft/PlanDraftReport.ts';
export { PlanDraftStatus } from '#src/contracts/plan/draft/PlanDraftStatus.ts';
export { PlanFixReport } from '#src/contracts/plan/draft/PlanFixReport.ts';
export { PlanFixStatus } from '#src/contracts/plan/draft/PlanFixStatus.ts';
export { PlanVariant } from '#src/contracts/plan/draft/PlanVariant.ts';
export { SourceEvidenceEntry } from '#src/contracts/plan/evidence/SourceEvidenceEntry.ts';
export { SourceEvidenceIndex } from '#src/contracts/plan/evidence/SourceEvidenceIndex.ts';
export { SourceEvidenceKind } from '#src/contracts/plan/evidence/SourceEvidenceKind.ts';
export { AuthoredFacts } from '#src/contracts/plan/facts/AuthoredFacts.ts';
export { ExploreArea } from '#src/contracts/plan/facts/ExploreArea.ts';
export { PathVerification } from '#src/contracts/plan/facts/PathVerification.ts';
export { PlanFacts } from '#src/contracts/plan/facts/PlanFacts.ts';
export { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
export { GapArea } from '#src/contracts/plan/grade/GapArea.ts';
export { GapBatchVerdict } from '#src/contracts/plan/grade/GapBatchVerdict.ts';
export { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
export { GapCheckReport } from '#src/contracts/plan/grade/GapCheckReport.ts';
export { GapGroupVerdict } from '#src/contracts/plan/grade/GapGroupVerdict.ts';
export { GapObservation } from '#src/contracts/plan/grade/GapObservation.ts';
export { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
export { GapVerdict } from '#src/contracts/plan/grade/GapVerdict.ts';
export { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
export { GradeReport } from '#src/contracts/plan/grade/GradeReport.ts';
export { PhaseWeight } from '#src/contracts/plan/grade/PhaseWeight.ts';
export { PlanGap } from '#src/contracts/plan/grade/PlanGap.ts';
export { PlanGrade } from '#src/contracts/plan/grade/PlanGrade.ts';
export { PlanWeight } from '#src/contracts/plan/grade/PlanWeight.ts';
export { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
export { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
export { LedgerRow } from '#src/contracts/plan/ledger/LedgerRow.ts';
export { ProseFile } from '#src/contracts/plan/ledger/ProseFile.ts';
export { GradeDecisionLog } from '#src/contracts/plan/memory/GradeDecisionLog.ts';
export { GradeDocsCoverage } from '#src/contracts/plan/memory/GradeDocsCoverage.ts';
export { GradeFindingRecord } from '#src/contracts/plan/memory/GradeFindingRecord.ts';
export { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';
export { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
export { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
export { GradeReadCoverage } from '#src/contracts/plan/memory/GradeReadCoverage.ts';
export { GradeScope } from '#src/contracts/plan/memory/GradeScope.ts';
export { PlanningProgress } from '#src/contracts/plan/progress/PlanningProgress.ts';
export { PlanningStep } from '#src/contracts/plan/progress/PlanningStep.ts';
export { PlanningStepRecord } from '#src/contracts/plan/progress/PlanningStepRecord.ts';
export { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';
export { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
export { BranchState } from '#src/contracts/queue/BranchState.ts';
export { QueueBoard } from '#src/contracts/queue/QueueBoard.ts';
export { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';
export { QueueLane } from '#src/contracts/queue/QueueLane.ts';
export { RelayAnswer } from '#src/contracts/queue/RelayAnswer.ts';
export { RelayQuestion } from '#src/contracts/queue/RelayQuestion.ts';
export { BatchOutcome } from '#src/contracts/refactor/BatchOutcome.ts';
export { BatchReport } from '#src/contracts/refactor/BatchReport.ts';
export { RefactorBatch } from '#src/contracts/refactor/RefactorBatch.ts';
export { RefactorWorklist } from '#src/contracts/refactor/RefactorWorklist.ts';
export { AcceptanceTestRecord } from '#src/contracts/run/AcceptanceTestRecord.ts';
export { AgentUsage } from '#src/contracts/run/AgentUsage.ts';
export { ApprovedTestRecord } from '#src/contracts/run/ApprovedTestRecord.ts';
export { CleanupEndReason } from '#src/contracts/run/CleanupEndReason.ts';
export { PackagesSource } from '#src/contracts/run/PackagesSource.ts';
export { PhaseReport } from '#src/contracts/run/PhaseReport.ts';
export { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
export { ProgressRecord } from '#src/contracts/run/ProgressRecord.ts';
export { RefactorStepReport } from '#src/contracts/run/RefactorStepReport.ts';
export { RunCommit } from '#src/contracts/run/RunCommit.ts';
export { RunLock } from '#src/contracts/run/RunLock.ts';
export { RunManifest } from '#src/contracts/run/RunManifest.ts';
export { RunStatus } from '#src/contracts/run/RunStatus.ts';
export { RunUsage } from '#src/contracts/run/RunUsage.ts';
export { StepRecord } from '#src/contracts/run/StepRecord.ts';
export { TestReviewRecord } from '#src/contracts/run/TestReviewRecord.ts';
export { StandardsCheckOverrides } from '#src/contracts/StandardsCheckOverrides.ts';
export { ShipBlockReason } from '#src/contracts/ship/ShipBlockReason.ts';
export { ShipMergeMethod } from '#src/contracts/ship/ShipMergeMethod.ts';
export { ShippingProgress } from '#src/contracts/ship/ShippingProgress.ts';
export { ShippingStepId } from '#src/contracts/ship/ShippingStepId.ts';
export { ShipResult } from '#src/contracts/ship/ShipResult.ts';
export { ShipStatus } from '#src/contracts/ship/ShipStatus.ts';
export { AdvisoryOutcome } from '#src/contracts/standardsCheck/AdvisoryOutcome.ts';
export { AdvisoryResponse } from '#src/contracts/standardsCheck/AdvisoryResponse.ts';
export { ReviewFindingRecord } from '#src/contracts/standardsCheck/ReviewFindingRecord.ts';
export { StandardsFinding } from '#src/contracts/standardsCheck/StandardsFinding.ts';
export { StandardsReviewReport } from '#src/contracts/standardsCheck/StandardsReviewReport.ts';
export { StandardsSeverity } from '#src/contracts/standardsCheck/StandardsSeverity.ts';
export { StandardsSnapshot } from '#src/contracts/standardsCheck/StandardsSnapshot.ts';
export { AgentInvocation } from '#src/contracts/views/AgentInvocation.ts';
export { ConfigFieldView } from '#src/contracts/views/config/ConfigFieldView.ts';
export { ConfigView } from '#src/contracts/views/config/ConfigView.ts';
export { FixtureSide } from '#src/contracts/views/FixtureSide.ts';
export { GateEvidence } from '#src/contracts/views/GateEvidence.ts';
export { PlanDocument } from '#src/contracts/views/PlanDocument.ts';
export { PlanDocumentKind } from '#src/contracts/views/PlanDocumentKind.ts';
export { PlanStage } from '#src/contracts/views/planWorkspace/PlanStage.ts';
export { PlanWorkspaceFile } from '#src/contracts/views/planWorkspace/PlanWorkspaceFile.ts';
export { PlanWorkspaceListing } from '#src/contracts/views/planWorkspace/PlanWorkspaceListing.ts';
export { PlanWorkspaceView } from '#src/contracts/views/planWorkspace/PlanWorkspaceView.ts';
export { RunListing } from '#src/contracts/views/RunListing.ts';
export { RunStepView } from '#src/contracts/views/RunStepView.ts';
export { RunView } from '#src/contracts/views/RunView.ts';
export { RunBurnDown } from '#src/contracts/views/runBurnDown/RunBurnDown.ts';
export { RunBurnDownBatch } from '#src/contracts/views/runBurnDown/RunBurnDownBatch.ts';
export { RunBurnDownBatchOutcome } from '#src/contracts/views/runBurnDown/RunBurnDownBatchOutcome.ts';
export { StandardsPackBundle } from '#src/contracts/views/StandardsPackBundle.ts';
export { StandardsPackDocumentView } from '#src/contracts/views/StandardsPackDocumentView.ts';
export { StandardsPackFixture } from '#src/contracts/views/StandardsPackFixture.ts';
export { StandardsPackListing } from '#src/contracts/views/StandardsPackListing.ts';
export { StandardsPackRuleListing } from '#src/contracts/views/StandardsPackRuleListing.ts';
export { StandardsPackRuleView } from '#src/contracts/views/StandardsPackRuleView.ts';
export { StandardsPackView } from '#src/contracts/views/StandardsPackView.ts';
export { StandardsRuleView } from '#src/contracts/views/StandardsRuleView.ts';
export { StandardsTrendPoint } from '#src/contracts/views/StandardsTrendPoint.ts';
export { StandardsView } from '#src/contracts/views/StandardsView.ts';
export { CommitMessage } from '#src/contracts/work/CommitMessage.ts';
export { SupervisorDecision } from '#src/contracts/work/SupervisorDecision.ts';
export { SupervisorVerdict } from '#src/contracts/work/SupervisorVerdict.ts';
export { TestChangeReview } from '#src/contracts/work/TestChangeReview.ts';
export { TestDisposition } from '#src/contracts/work/TestDisposition.ts';
export { TestReviewDecision } from '#src/contracts/work/TestReviewDecision.ts';
export { WorkOrderName } from '#src/contracts/work/WorkOrderName.ts';
export { WorkReport } from '#src/contracts/work/WorkReport.ts';
export { WorkReportStatus } from '#src/contracts/work/WorkReportStatus.ts';
export { WritersReport } from '#src/contracts/work/WritersReport.ts';
export { PlanId } from '#src/contracts/workOrder/PlanId.ts';
export { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
export { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
export { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
export { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
export { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
export { WorkOrderSyncState } from '#src/contracts/workOrder/WorkOrderSyncState.ts';
export { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
export { WorktreeRecord } from '#src/contracts/worktree/WorktreeRecord.ts';
