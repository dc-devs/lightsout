import { dirname, join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { PhaseReport, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { readRunManifest } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	manifest: RunManifest;
}
/** Existing completion records prove prerequisites; source is conservatively checked again by the resumed child's ordinary gates. */
export const validateSequenceHandoff = async ({ cwd, manifest }: Params): Promise<RunManifest> => {
	const handoff = manifest.planningHandoff;
	if (!handoff) return manifest;
	if (canonicalJson({ value: manifest.steps.map((step) => step.id) }) !== canonicalJson({ value: handoff.phases.map((phase) => phase.path) }))
		throw new Error('Coordinator steps differ from the frozen phase order');
	for (const step of manifest.steps.filter((step) => step.status === RunStatus.Passed)) {
		const report = PhaseReport.parse(step.report);
		const child = await readRunManifest({ cwd, runId: report.runId });
		if (
			child.status !== RunStatus.Passed ||
			child.parentRunId !== manifest.runId ||
			child.plan !== join(dirname(manifest.plan), step.id) ||
			canonicalJson({ value: child.planningHandoff }) !== canonicalJson({ value: handoff })
		)
			throw new Error('Completed phase has no matching child under this handoff');
	}
	const steps = manifest.steps.every((step) => step.status === RunStatus.Passed)
		? manifest.steps.map((step, index) => (index === manifest.steps.length - 1 ? { ...step, status: RunStatus.Pending } : step))
		: manifest.steps;
	return { ...manifest, steps };
};
