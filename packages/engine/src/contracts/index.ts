// Re-exported from the shared package rather than declared here. These are the
// shapes a standards pack implements, so they belong to something a pack
// author can install — the engine is one consumer of them among others, not
// their owner. Passing them through this barrel keeps engine code saying
// `#src/contracts/index.ts` for every contract it uses, whoever declares it.
export type {
	CloneSpan,
	CloneSpansInput,
	FileListInput,
	FileTextInput,
	FrameworkFacts,
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
	StandardsFrameworksModule,
	StandardsInputKind,
	StandardsPackRoot,
	StandardsSet,
} from '@lightsout/standards-contracts';
export { ConfigAutoPlan } from '#src/contracts/ConfigAutoPlan.ts';
export { ConfigCommands } from '#src/contracts/ConfigCommands.ts';
export { ConfigDocs } from '#src/contracts/ConfigDocs.ts';
export { ConfigGates } from '#src/contracts/ConfigGates.ts';
export { ConfigPlan } from '#src/contracts/ConfigPlan.ts';
export { ConfigQueue } from '#src/contracts/ConfigQueue.ts';
export { ConfigShip } from '#src/contracts/ConfigShip.ts';
export { ConfigTicketTracker } from '#src/contracts/ConfigTicketTracker.ts';
export {
	CommandActor,
	CommandCatalogEntry,
	CommandFlag,
	CommandGroup,
	CommandInvocation,
	CommandRecordKind,
	CommandStep,
} from '#src/contracts/commands/index.ts';
export { CoverageBatchReport, CoverageFile, CoverageTotal, CoverageWorklist } from '#src/contracts/coverage/index.ts';
export { DedupFinding, DedupJudgment, DedupReport, DedupResolution, DedupVerdict, ReviewedCollision } from '#src/contracts/dedup/index.ts';
export { Effort } from '#src/contracts/Effort.ts';
export { FrictionArea, FrictionEntry, FrictionRecord } from '#src/contracts/friction/index.ts';
export { GateOverride } from '#src/contracts/GateOverride.ts';
export { GateOverrides } from '#src/contracts/GateOverrides.ts';
export { GateResult } from '#src/contracts/gates/index.ts';
export { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
export { PackageGates } from '#src/contracts/PackageGates.ts';
export { Permissions } from '#src/contracts/Permissions.ts';
export {
	AuthoredFacts,
	BrainstormDecisions,
	DecisionRow,
	DecisionSource,
	DecisionsRecord,
	ExploreArea,
	FindingSeverity,
	GapArea,
	GapCheckLens,
	GapCheckReport,
	GapOutcome,
	GapVerdict,
	GradedGap,
	GradeReport,
	LedgerRow,
	PathVerification,
	PhaseWeight,
	PlanDraftReport,
	PlanDraftStatus,
	PlanFacts,
	PlanFixReport,
	PlanFixStatus,
	PlanGap,
	PlanGrade,
	PlanVariant,
	PlanWeight,
	ProseFile,
	StructuralCheck,
	StructuralFinding,
} from '#src/contracts/plan/index.ts';
export { BranchPhase, BranchState, RelayAnswer, RelayQuestion } from '#src/contracts/queue/index.ts';
export { BatchOutcome, BatchReport, RefactorBatch, RefactorWorklist } from '#src/contracts/refactor/index.ts';
export {
	AgentUsage,
	LedgerTestRecord,
	PackagesSource,
	PhaseReport,
	PipelineKind,
	ProgressRecord,
	RunLock,
	RunManifest,
	RunStatus,
	RunUsage,
	StepRecord,
} from '#src/contracts/run/index.ts';
export { StandardsCheckOverrides } from '#src/contracts/StandardsCheckOverrides.ts';
export { ShipBlockReason, ShipMergeMethod, ShipResult, ShipStatus } from '#src/contracts/ship/index.ts';
export {
	AdvisoryOutcome,
	AdvisoryResponse,
	ReviewFindingRecord,
	StandardsFinding,
	StandardsReviewReport,
	StandardsSeverity,
	StandardsSnapshot,
} from '#src/contracts/standardsCheck/index.ts';
export {
	AgentInvocation,
	ConfigFieldView,
	ConfigView,
	FixtureSide,
	GateEvidence,
	PlanDocument,
	PlanDocumentKind,
	PlanStage,
	PlanWorkspaceFile,
	PlanWorkspaceListing,
	PlanWorkspaceView,
	RunBurnDown,
	RunBurnDownBatch,
	RunBurnDownBatchOutcome,
	RunListing,
	RunStepView,
	RunView,
	StandardsPackBundle,
	StandardsPackDocumentView,
	StandardsPackFixture,
	StandardsPackListing,
	StandardsPackRuleListing,
	StandardsPackRuleView,
	StandardsPackView,
	StandardsRuleView,
	StandardsTrendPoint,
	StandardsView,
} from '#src/contracts/views/index.ts';
export { SupervisorDecision, SupervisorVerdict, WorkReport, WorkReportStatus, WritersReport } from '#src/contracts/work/index.ts';
