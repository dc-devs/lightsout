// Re-exported from the shared package rather than declared here. These are the
// shapes a standards package implements, so they belong to something a package
// author can install — the engine is one consumer of them among others, not
// their owner. Passing them through this barrel keeps engine code saying
// `#src/contracts/index.ts` for every contract it uses, whoever declares it.
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
} from '@lightsout/standards-contracts';
export { RawStandardsFinding, StandardsCheckModule, StandardsInputKind, StandardsPackageRoot, StandardsSet } from '@lightsout/standards-contracts';
export { ConfigCommands } from '#src/contracts/ConfigCommands.ts';
export { ConfigGates } from '#src/contracts/ConfigGates.ts';
export { CoverageBatchReport, CoverageFile, CoverageTotal, CoverageWorklist } from '#src/contracts/coverage/index.ts';
export { DedupFinding, DedupJudgment, DedupReport, DedupResolution, DedupVerdict } from '#src/contracts/dedup/index.ts';
export { Effort } from '#src/contracts/Effort.ts';
export { FrictionArea, FrictionEntry, FrictionRecord } from '#src/contracts/friction/index.ts';
export { GateResult } from '#src/contracts/gates/index.ts';
export { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
export { PackageGates } from '#src/contracts/PackageGates.ts';
export { Permissions } from '#src/contracts/Permissions.ts';
export {
	AuthoredFacts,
	BrainstormDecisions,
	DecisionRow,
	DecisionsRecord,
	ExploreArea,
	GapArea,
	GapCheckReport,
	GradeReport,
	PathVerification,
	PlanDraftReport,
	PlanDraftStatus,
	PlanFacts,
	PlanFixReport,
	PlanFixStatus,
	PlanGap,
	PlanGrade,
	PlanVariant,
	StructuralCheck,
	StructuralFinding,
} from '#src/contracts/plan/index.ts';
export { BatchOutcome, BatchReport, RefactorBatch, RefactorWorklist } from '#src/contracts/refactor/index.ts';
export { AgentUsage, PackagesSource, PhaseReport, PipelineKind, RunLock, RunManifest, RunStatus, RunUsage, StepRecord } from '#src/contracts/run/index.ts';
export { StandardsCheckOverrides } from '#src/contracts/StandardsCheckOverrides.ts';
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
	GateEvidence,
	PlanDocument,
	PlanDocumentKind,
	RunListing,
	RunStepView,
	RunView,
	StandardsRuleView,
	StandardsTrendPoint,
	StandardsView,
} from '#src/contracts/views/index.ts';
export { SupervisorDecision, SupervisorVerdict, WorkReport, WorkReportStatus, WritersReport } from '#src/contracts/work/index.ts';
