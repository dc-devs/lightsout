import { dirname, join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type AcceptanceTestRecord, PhaseReport, PipelineKind, type PlanningHandoff, RunStatus } from '#src/contracts/index.ts';
import { readRunManifest } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	plan: string;
	parentRunId?: string;
	handoff?: PlanningHandoff;
}
export const readHandoffPrerequisites = async ({ cwd, plan, parentRunId, handoff }: Params): Promise<AcceptanceTestRecord[]> => {
	if (!handoff) return [];
	const index = handoff.phases.findIndex((phase) => join('.lightsout/plans', handoff.name, phase.path) === plan);
	if (index < 0 && handoff.phases.length) throw new Error('A phased handoff must execute a frozen phase');
	if (!parentRunId && index > 0) throw new Error('Later phases require a coordinator with completed prerequisites');
	let rows: AcceptanceTestRecord[] = [];
	if (parentRunId) {
		const parent = await readRunManifest({ cwd, runId: parentRunId });
		if (parent.pipeline !== PipelineKind.Phases || canonicalJson({ value: parent.planningHandoff }) !== canonicalJson({ value: handoff }))
			throw new Error('Child handoff differs from its coordinator');
		for (const phase of handoff.phases.slice(0, index)) {
			const step = parent.steps.find((step) => step.id === phase.path);
			if (step?.status !== RunStatus.Passed) throw new Error('Planning prerequisite is unfinished');
			const report = PhaseReport.parse(step.report);
			const child = await readRunManifest({ cwd, runId: report.runId });
			if (
				child.status !== RunStatus.Passed ||
				child.parentRunId !== parentRunId ||
				child.plan !== join(dirname(parent.plan), phase.path) ||
				canonicalJson({ value: child.planningHandoff }) !== canonicalJson({ value: handoff })
			)
				throw new Error('Planning prerequisite has no matching completed child');
			rows = child.acceptanceTests;
		}
	}
	return rows;
};
