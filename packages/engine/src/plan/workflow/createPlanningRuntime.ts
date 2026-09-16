import { resolveCommandHarness } from '#src/common/config/resolveCommandHarness.ts';
import { type LightsoutConfig, type Permissions, PlanningVocabulary } from '#src/contracts/index.ts';
import { type Driver, getDriverCapabilities, getMissingEnvironmentControls } from '#src/drivers/index.ts';
import type { PlanningMode } from '#src/plan/workflow/common/constants/PlanningMode.ts';
import { planningRoleEnvironment } from '#src/plan/workflow/common/constants/planningRoleEnvironment.ts';
import { buildPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/buildPlanningExecutionPolicy.ts';
import { buildPlanningIntegrationContext } from '#src/plan/workflow/common/review/buildPlanningIntegrationContext.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/index.ts';
import { draftPlanningArtifacts, renderPlanningSections, validatePlanningArtifacts } from '#src/plan/workflow/draft/index.ts';
import { pendingPlanningProposal } from '#src/plan/workflow/proposal/index.ts';
import {
	collectPlanningPriorArt,
	evaluatePlanningReadiness,
	invalidatePlanningEvidence,
	planReviewCoverage,
	reviewPlanningIntegration,
} from '#src/plan/workflow/review/index.ts';
import { PlanningLease } from '#src/plan/workflow/store/index.ts';

interface Params {
	cwd: string;
	name: string;
	driver: Driver;
	config: LightsoutConfig;
	mode: PlanningMode;
	stage: PlanningRuntime['stage'];
	onProgress?: (message: string) => void;
	permissions?: Permissions;
}

/** Compose the production planner without spawning a provider or changing persistent configuration. */
export const createPlanningRuntime = async ({
	cwd,
	name,
	driver,
	config: supplied,
	mode,
	stage,
	onProgress,
	permissions,
}: Params): Promise<PlanningRuntime> => {
	const config = structuredClone(supplied);
	const execution = resolveCommandHarness({ config, command: 'plan' });
	if (execution.driverName !== driver.name) throw new Error(`Planning requires configured harness ${execution.driverName}; received ${driver.name}`);
	const missing = getMissingEnvironmentControls({ environment: planningRoleEnvironment, capabilities: getDriverCapabilities({ name: driver.name }) });
	if (missing.length) throw new Error(`The ${driver.name} harness cannot provide required planning controls: ${missing.join(', ')}`);
	const standards = await resolvePlanningStandards({
		cwd,
		config,
		role: PlanningVocabulary.Role.Architect,
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
	});
	const runtime: PlanningRuntime = {
		cwd,
		name,
		driver,
		config,
		mode,
		stage,
		onProgress,
		model: execution.model,
		effort: execution.effort,
		permissions: permissions ?? config.permissions,
		standards: standards.content,
		lease: new PlanningLease({ cwd, name }),
		services: {
			proposal: pendingPlanningProposal,
			priorArt: collectPlanningPriorArt,
			integrationContext: async ({ snapshot }) => buildPlanningIntegrationContext({ snapshot }),
			render: renderPlanningSections,
			draft: draftPlanningArtifacts,
			validate: validatePlanningArtifacts,
			invalidate: invalidatePlanningEvidence,
			evaluate: evaluatePlanningReadiness,
			coverage: planReviewCoverage,
			integration: reviewPlanningIntegration,
		},
	};
	runtime.executionPolicy = buildPlanningExecutionPolicy({ runtime, standards });
	return runtime;
};
