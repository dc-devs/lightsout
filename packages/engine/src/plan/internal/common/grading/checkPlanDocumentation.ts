import { basename } from 'node:path';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { buildPlanDocsCheckInvocation } from '#src/agents/buildPlanDocsCheckInvocation.ts';
import type { ConfigDocs } from '#src/contracts/ConfigDocs.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { Permissions } from '#src/contracts/Permissions.ts';
import { GapArea } from '#src/contracts/plan/grade/GapArea.ts';
import { GapCheckReport } from '#src/contracts/plan/grade/GapCheckReport.ts';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import type { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DeliverableFile } from '#src/plan/internal/common/types/DeliverableFile.ts';
import { createPlanAgentRunner } from '#src/plan/internal/common/utils/createPlanAgentRunner.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — used in the progress line and the re-run command. */
	name: string;
	/** The plan's workspace, where this step's transcript lands. */
	workspaceDir: string;
	/** Every plan path, overview first when there is one — its head names the file the finding is stamped with. */
	planPaths: string[];
	/** Every implementable plan file with its text — the whole deliverable, never a `--phase` narrowing. */
	files: DeliverableFile[];
	/** Overview text for a phased plan; absent for a single plan. */
	overviewText?: string;
	/** The repository's declared surfaces. Absent → no spawn, no findings, no failure. */
	docs?: ConfigDocs;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	/** Agent ceiling, resolved by the caller — this pass reads the same volume of plan text the readers do, so it shares their number. */
	timeoutMs: number;
	/** The pass level this checker's spawn opens its step under. Named at the call site, because this `Params` is built field by field rather than spread. */
	level?: ActivityLevel;
	onProgress: (message: string) => void;
}

/**
 * The once-per-grade whole-plan documentation pass: one checker reads the whole
 * deliverable and verifies the claim its `## Documentation` sections state.
 *
 * A repository that declares no `docs` block pays nothing — no runner, no
 * transcript file, no spawn. That is what makes the key one line of config
 * rather than a documentation pipeline.
 *
 * Every identity field on a returned finding is the engine's rather than the
 * agent's, which is the rule the reader fold already follows when it stamps a
 * gap's phase and lens: a checker must not be able to file its finding under an
 * area it was not given. `lens` is deliberately omitted — no per-file lens
 * produced this finding, which is what makes the field optional — and the
 * outcome is stamped `needs-a-human` rather than routed to a judge, because the
 * checker's entire job is that judgment and a second judge able to rule it
 * agent-decidable would silently drop the only documentation check there is.
 */
export const checkPlanDocumentation = async (params: Params): Promise<{ gaps: GradedGap[]; failures: string[]; rateLimited: boolean }> => {
	const { cwd, driver, name, workspaceDir, planPaths, files, overviewText, docs, model, effort, permissions } = params;
	const { timeoutMs, level, onProgress } = params;

	if (docs === undefined || docs.length === 0) {
		return { gaps: [], failures: [], rateLimited: false };
	}

	const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step: 'grade-documentation', model, effort, permissions, timeoutMs, level });
	const outcome = await invokePlanAgent({
		invocation: buildPlanDocsCheckInvocation({
			planFiles: files.map((file) => ({ file: basename(file.path), text: file.text })),
			overviewText,
			docs,
		}),
		contract: GapCheckReport,
	});

	if (!outcome.ok) {
		onProgress(`plan grade ${name}: documentation check did not run against ${docs.length} declared surface(s)`);

		return {
			gaps: [],
			failures: [`documentation: ${outcome.rateLimited ? 'rate limited or overloaded' : outcome.failure}`],
			rateLimited: outcome.rateLimited,
		};
	}

	// `planPaths[0]` is the overview for a phased plan and the single plan file
	// otherwise, so the finding is labelled with the file that stands for the
	// whole deliverable — the rule the lint already applies when it gives the
	// overview the union of every declared script.
	const gaps = outcome.report.gaps.map((gap) => ({
		...gap,
		area: GapArea.MissingDocumentation,
		phase: basename(planPaths[0]),
		outcome: GapOutcome.NeedsAHuman,
		observations: [],
	}));

	onProgress(`plan grade ${name}: documentation check — ${gaps.length} finding(s) against ${docs.length} declared surface(s)`);

	return { gaps, failures: [], rateLimited: false };
};
