import { printPlanningFinding } from '#src/cli/common/render/planning/printPlanningFinding.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { preparePlanningCommand } from '#src/cli/plan/common/utils/preparePlanningCommand.ts';
import { type LightsoutConfig, PlanningStep, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { PlanRunStatus, readPlanningSnapshot, recordPlanningStep, runPlanDedup } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
}

/** Display the canonical investigation and findings without manufacturing standalone duplication judgments. */
export const planDedupCommand = async ({ cwd, driver, name, config }: Params): Promise<void> => {
	const runtime = await preparePlanningCommand({ cwd, driver, name, config });
	const result = await recordPlanningStep({
		cwd,
		name,
		step: PlanningStep.Dedup,
		work: () => runPlanDedup({ runtime }),
		statusOf: ({ result: scanned }) => (scanned.status === PlanRunStatus.Complete && scanned.dedup.complete ? RunStatus.Passed : RunStatus.Failed),
	});
	if ('error' in result) console.error(result.error);
	const dedup = 'dedup' in result ? result.dedup : undefined;
	if (!dedup || !result.dedupPath || !dedup.workflow) return exitCli({ code: 1 });
	const snapshot = await readPlanningSnapshot({ cwd, name, generation: dedup.workflow.generation });
	if (!snapshot) throw new Error('The recorded prior-art generation is unavailable');
	console.log(`plan dedup ${name} — ${dedup.complete ? 'complete' : 'incomplete'} canonical investigation`);
	if (dedup.incompleteReason) console.log(dedup.incompleteReason);
	console.log(
		`generation: ${snapshot.digest}; observations: ${dedup.workflow.observationArtifacts.length}; independent coverage: ${dedup.workflow.coverageReceiptIds.length} receipt(s)`,
	);
	for (const id of dedup.workflow.findingIds) {
		const finding = snapshot.record.findings.find((item) => item.id === id);
		if (!finding) throw new Error(`The recorded canonical finding is unavailable: ${id}`);
		printPlanningFinding({ finding });
	}
	console.log(`dedup: ${result.dedupPath}`);
	return exitCli({ code: dedup.complete ? 0 : 1 });
};
