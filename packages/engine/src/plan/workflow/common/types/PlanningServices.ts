import type {
	PlanningDependency,
	PlanningReadiness,
	PlanningRoleResult,
	PlanningRunResult,
	PlanningVocabulary,
	PlanningWork,
	StructuralFinding,
} from '#src/contracts/index.ts';
import type { PlanningAssuranceContext } from '#src/plan/workflow/common/types/PlanningAssuranceContext.ts';
import type { PlanningIntegrationContext } from '#src/plan/workflow/common/types/PlanningIntegrationContext.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSemanticDelta } from '#src/plan/workflow/common/types/PlanningSemanticDelta.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

/** Ports let the scheduler enforce sequencing before production role implementations are composed. */
export interface PlanningServices {
	proposal?: (params: {
		runtime: PlanningRuntime;
		snapshot: PlanningSnapshot;
		ready: boolean;
		assurance?: PlanningAssuranceContext;
	}) => Promise<Extract<PlanningRunResult, { status: typeof PlanningVocabulary.Status.AwaitingUser }> | undefined>;
	priorArt?: (params: { runtime: PlanningRuntime; snapshot: PlanningSnapshot; work: PlanningWork }) => Promise<PlanningSnapshot>;
	integrationContext?: (params: { runtime: PlanningRuntime; snapshot: PlanningSnapshot }) => Promise<PlanningIntegrationContext>;
	/** Pure projection before receipt creation; authored unknown spans must fail without loss. */
	render?: (params: { snapshot: PlanningSnapshot; artifacts: ReadonlyMap<string, string>; previous?: PlanningSnapshot }) => Map<string, string>;
	draft: (params: { runtime: PlanningRuntime; snapshot: PlanningSnapshot; work: PlanningWork }) => Promise<PlanningRoleResult>;
	validate: (params: { runtime: PlanningRuntime; snapshot: PlanningSnapshot; artifacts: ReadonlyMap<string, string> }) => Promise<StructuralFinding[]>;
	invalidate: (params: { snapshot: PlanningSnapshot; changedDependencies: PlanningDependency[]; changedClaimIds: string[]; delta?: PlanningSemanticDelta }) => {
		workIds: string[];
		receiptIds: string[];
		reason: string;
		work?: PlanningWork[];
		reopenFindingIds?: string[];
	};
	evaluate: (params: {
		snapshot: PlanningSnapshot;
		structural: StructuralFinding[];
		dependenciesCurrent: boolean;
		assurance?: PlanningAssuranceContext;
		stage: (typeof PlanningVocabulary.Stage)[keyof typeof PlanningVocabulary.Stage];
	}) => PlanningReadiness;
	coverage?: (params: { snapshot: PlanningSnapshot; stage: PlanningRuntime['stage'] }) => PlanningWork[];
	integration: (params: { runtime: PlanningRuntime; snapshot: PlanningSnapshot }) => Promise<PlanningRoleResult>;
}
