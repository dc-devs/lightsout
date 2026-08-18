// Re-exported from the shared package rather than declared here. These are the
// shapes a standards package implements, so they belong to something a package
// author can install — the engine is one consumer of them among others, not
// their owner. Passing them through this barrel keeps engine code saying
// `@/contracts` for every contract it uses, whoever declares it.
export type {
	CloneSpan,
	CloneSpansInput,
	FileListInput,
	FileTextInput,
	ImportGraphInput,
	StandardsCheckInput,
	StandardsCheckRun,
	SyntaxTreeInput,
	TestFileInput,
} from '@lightsout/standards-contracts';
export { RawStandardsFinding, StandardsCheckModule, StandardsInputKind, StandardsPackageRoot, StandardsSet } from '@lightsout/standards-contracts';
export { ConfigCommands } from '@/contracts/ConfigCommands';
export { ConfigGates } from '@/contracts/ConfigGates';
export { CoverageBatchReport, CoverageFile, CoverageTotal, CoverageWorklist } from '@/contracts/coverage';
export { DedupFinding, DedupJudgment, DedupReport, DedupResolution, DedupVerdict } from '@/contracts/dedup';
export { Effort } from '@/contracts/Effort';
export { FrictionArea, FrictionEntry, FrictionRecord } from '@/contracts/friction';
export { GateResult } from '@/contracts/gates';
export { LightsoutConfig } from '@/contracts/LightsoutConfig';
export { PackageGates } from '@/contracts/PackageGates';
export { Permissions } from '@/contracts/Permissions';
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
} from '@/contracts/plan';
export { BatchOutcome, BatchReport, RefactorBatch, RefactorWorklist } from '@/contracts/refactor';
export { AgentUsage, PackagesSource, PhaseReport, RunLock, RunManifest, RunStatus, RunUsage, StepRecord } from '@/contracts/run';
export { StandardsCheckOverrides } from '@/contracts/StandardsCheckOverrides';
export { AdvisoryOutcome, AdvisoryResponse, StandardsFinding, StandardsReviewReport, StandardsSeverity } from '@/contracts/standardsCheck';
export { SupervisorDecision, SupervisorVerdict, WorkReport, WorkReportStatus } from '@/contracts/work';
