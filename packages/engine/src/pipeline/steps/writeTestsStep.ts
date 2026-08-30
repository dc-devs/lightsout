import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { excludedSourcePaths } from '#src/common/sourceFiles/excludedSourcePaths.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { resolveTestSubjects } from '#src/pipeline/common/utils/resolveTestSubjects.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { groupTestTargets } from '#src/pipeline/steps/groupTestTargets.ts';
import { runWriterBatches } from '#src/pipeline/steps/runWriterBatches.ts';
import { selectTestTargets } from '#src/pipeline/steps/selectTestTargets.ts';
import { getPackFrameworkFacts } from '#src/standardsPacks/index.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	testStandards?: string;
}

const narrateSkippedFiles = ({ run, deleted, inert, uncoverable }: { run: PipelineRun; deleted: string[]; inert: string[]; uncoverable: string[] }) => {
	if (deleted.length > 0) {
		run.progress(`write-tests: ${deleted.length} deleted file(s) skipped (removed by the plan, nothing to cover): ${deleted.join(', ')}`);
	}

	if (inert.length > 0) {
		run.progress(`write-tests: ${inert.length} inert file(s) skipped (barrel/type-only, nothing to cover): ${inert.join(', ')}`);
	}

	if (uncoverable.length > 0) {
		run.progress(
			`write-tests: ${uncoverable.length} file(s) skipped — no unit test could move their coverage (a tool's own settings file, a module-scope await the runner cannot load, or a path this repo's coverage configuration does not collect): ${uncoverable.join(', ')}`,
		);
	}
};

/** The write-tests fan-out: changed files resolve up to their public subjects, one writer per import-graph group — groups' subjects are disjoint across clusters, so parallel writers cannot collide on disk. */
export const writeTestsStep = ({ run, gitPrefix, planContent, testStandards }: Params): PipelineStep['run'] => {
	return async () => {
		let record = run.nextRecord({ id: 'write-tests' });

		await run.setStep({ record });

		const packagesDir = run.config['packages-dir'] ?? defaultPackagesDir;
		const compiler = resolveConsumerTypescript({ cwd: run.cwd, packagesDir });
		const { targets, inert, uncoverable, deleted, coverageExcluded } = await selectTestTargets({
			run,
			candidates: sourceFiles({ run }),
			compiler,
			packagesDir,
		});

		narrateSkippedFiles({ run, deleted, inert, uncoverable });

		const universe = (await listSourceFiles({ cwd: run.cwd, exclude: excludedSourcePaths({ config: run.config }) })).files;
		const frameworkFacts = await getPackFrameworkFacts({ cwd: run.cwd, packagesDir, config: run.config });
		const { subjects, orphans } = await resolveTestSubjects({ cwd: run.cwd, targets, universe, packagesDir, compiler, frameworkFacts });

		if (orphans.length > 0) {
			run.progress(
				`write-tests: ${orphans.length} changed file(s) skipped — nothing public reaches them (no barrel exports a surface that imports them): ${orphans.join(', ')}`,
			);
		}

		const testSubjects = [...new Set([...subjects.values()].flat())].sort();

		// Persisted before any writer spawns — a crash mid-fan-out must not lose
		// the skip record or the subjects a verify fix re-invocation hands back.
		await run.setStep({ record, patch: { testSubjects, unreachableChangedFiles: orphans, coverageExcludedChangedFiles: coverageExcluded } });

		const groups = await groupTestTargets({ run, subjects, compiler });

		run.progress(
			`step write-tests — attempt ${record.attempts} · ${groups.length} group(s): ${testSubjects.length} subject(s) covering ${subjects.size} changed file(s), up to ${testWriterConcurrency} writers in parallel`,
		);
		const { reports, failures, terminated, parked } = await runWriterBatches({ run, groups, planContent, testStandards });

		// Persist whatever progress the batches made before deciding the
		// outcome — a parked or stopped run must still know what was touched.
		record = withStepFiles({ record, reports, gitPrefix });

		await run.setStep({
			record: { ...record, report: { reports } },
			patch: {
				...(await collectChanged({ run, gitPrefix, reports })),
				testSubjects,
				unreachableChangedFiles: orphans,
				coverageExcludedChangedFiles: coverageExcluded,
			},
		});

		if (parked) {
			return run.stop({ record: { ...record, report: { reports } }, status: RunStatus.PausedRateLimit, error: run.parkMessage() });
		}

		if (failures.length > 0) {
			return run.stop({
				record: { ...record, report: { reports } },
				status: terminated ? RunStatus.Escalated : RunStatus.Failed,
				error: `write-tests: ${failures.length} of ${groups.length} writer(s) did not complete:\n${failures.join('\n')}`,
			});
		}

		await run.setStep({ record: { ...record, status: RunStatus.Passed, report: { reports } } });
		run.progress('step write-tests passed');

		return undefined;
	};
};
