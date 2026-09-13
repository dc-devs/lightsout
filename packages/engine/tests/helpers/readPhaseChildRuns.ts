import { PhaseReport, type RunManifest } from '#src/contracts/index.ts';
import { readRunManifest } from '#src/runState/index.ts';

/** The per-phase run behind each coordinator step of a phased sequence, in phase order. */
export const readPhaseChildRuns = ({ cwd, manifest }: { cwd: string; manifest: RunManifest }): Promise<RunManifest[]> =>
	Promise.all(manifest.steps.map((step) => readRunManifest({ cwd, runId: PhaseReport.parse(step.report).runId })));
