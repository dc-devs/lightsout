import { PhaseReport } from '#src/contracts/run/PhaseReport.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { readRunManifest } from '#src/runState/readRunManifest.ts';

/** The per-phase run behind each coordinator step of a phased sequence, in phase order. */
export const readPhaseChildRuns = ({ cwd, manifest }: { cwd: string; manifest: RunManifest }): Promise<RunManifest[]> =>
	Promise.all(manifest.steps.map((step) => readRunManifest({ cwd, runId: PhaseReport.parse(step.report).runId })));
