import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	buildFeatureExecutorInvocation,
	buildRefactorExecutorInvocation,
	buildUnitTestWriterInvocation,
	formatFindingSite,
} from '@lightsout/agents';
import {
	PackagesSource,
	RunStatus,
	WorkReportStatus,
	type LightsoutConfig,
	type RunManifest,
	type ScanFinding,
	type StepRecord,
	type WorkReport,
} from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { appendCommandLog } from '../runState';
import { appendFriction } from '../runState';
import { chunkFileGroup } from './chunkFileGroup';
import { collectImportEdges } from '../common/utils/collectImportEdges';
import { createRun } from '../runState';
import { groupConnectedFiles } from './groupConnectedFiles';
import { isInertSourceFile } from './isInertSourceFile';
import { packageOf } from '../common/utils/packageOf';
import { resolveConsumerTypescript } from '../common/utils/resolveConsumerTypescript';
import { readGitChangedFiles } from '../common/git/readGitChangedFiles';
import { readGitPrefix } from '../common/git/readGitPrefix';
import { readPlanPackages } from './readPlanPackages';
import { detectStandardsChannels } from '../standards';
import { readStandards } from '../standards';
import { withRunLock } from '../runState';
import { PipelineRun } from './PipelineRun';
import type { PipelineStep } from './PipelineStep';
import { collectChanged as collectChangedFor } from './common/utils/collectChanged';
import { gates as gatesFor } from './common/utils/gates';
import { sourceFiles as sourceFilesFor } from './common/utils/sourceFiles';
import { withStepFiles as withStepFilesFor } from './common/utils/withStepFiles';
import { verifyStep } from './steps/verifyStep';
import { workStep } from './steps/workStep';
import { scanPlanPackagePaths } from './scanPlanPackagePaths';
import { runCommand } from '../common/utils/runCommand';
import { runScan } from '../scan';
import { selectScanFindings } from '../scan';
import type { PipelineResult } from './PipelineResult';

const formatTimeoutMs = 10 * 60_000;
const maxRefactorPasses = 3;
const testWriterConcurrency = 5;
/** Pathological guard: an import component above this splits into sorted chunks — no config knob until live evidence asks for one. */
const maxWriterGroupFiles = 12;
interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	/** Plan path for a fresh run. Ignored when resuming (the manifest owns it). */
	planPath?: string;
	/** Optional overview plan path (high-level context for a phased plan). Ignored when resuming. */
	overviewPath?: string;
	/** Package scope override (monorepo mode). Falls back to the plan front-matter `packages:` list. */
	packages?: string[];
	/** Resume: an existing manifest — steps already passed are skipped. */
	existing?: RunManifest;
	skipRefactor?: boolean;
	/** Live progress sink (steps, gate results, agent reports). Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * The pipeline body — always entered holding the run lock (the exported
 * wrapper below acquires and releases it around this).
 *
 * Clean-slate gate → implement → verify → write-tests (one writer per source
 * file, in parallel) → verify → refactor (looped until a pass changes
 * nothing) → verify → format. Every state transition is persisted before the
 * next action, so a crash, rate-limit park, or escalation at any point
 * leaves a resumable, truthful record on disk — resume re-enters here and
 * walks past every step already marked passed.
 *
 * Changed files flow step to step through the manifest: each agent's typed
 * report is merged with a git snapshot (minus the run's baseline dirt), and
 * the merged list feeds the next role's invocation.
 */
const executePipeline = async ({
	cwd,
	runId,
	driver,
	config,
	planPath,
	overviewPath,
	packages,
	existing,
	skipRefactor,
	onProgress,
}: Params & { runId: string }): Promise<PipelineResult> => {
	const run = new PipelineRun({
		cwd,
		config,
		driver,
		onProgress,
		manifest:
			existing ??
			(await createRun({
				cwd,
				runId,
				plan: planPath ?? '',
				pipeline: 'implement',
				overview: overviewPath,
				driver: driver.name,
				config,
				baselineDirtyFiles: await readGitChangedFiles({ cwd }),
			})),
	});
	const progress = (message: string) => run.progress(message);
	const setStep = run.setStep.bind(run);
	const stop = run.stop.bind(run);
	const nextRecord = run.nextRecord.bind(run);
	const update = run.update.bind(run);
	const parkMessage = () => run.parkMessage();

	const planContent = await readFile(join(cwd, run.current().plan), 'utf8').catch(() => undefined);

	if (planContent === undefined) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: `plan file not found: ${join(cwd, run.current().plan)}`,
		});
	}

	const overviewContent = run.current().overview
		? await readFile(join(cwd, run.current().overview ?? ''), 'utf8').catch(() => undefined)
		: undefined;

	if (run.current().overview && overviewContent === undefined) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: `overview file not found: ${join(cwd, run.current().overview ?? '')}`,
		});
	}

	const packagesDir = config.packagesDir ?? 'packages';

	// Monorepo mode needs a scope before any gate runs. The chain: --packages
	// flag → plan front-matter → concrete package paths in the plan body (safe
	// fallback: over-inclusion only runs extra gates, under-inclusion is
	// caught by scope expansion) → hard error. Never inference beyond that.
	if (config.packageScripts && run.current().packages.length === 0) {
		const fromFlag = packages;
		const fromFrontMatter = fromFlag ? undefined : readPlanPackages({ planContent });
		const fromPlanPaths = (fromFlag ?? fromFrontMatter) ? undefined : scanPlanPackagePaths({ planContent, packagesDir });
		const declared = fromFlag ?? fromFrontMatter ?? fromPlanPaths;

		if (!declared || declared.length === 0) {
			return stop({
				record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
				status: RunStatus.Failed,
				error: `packageScripts is configured but no package scope could be resolved — add a \`packages:\` list to the plan front-matter, pass --packages <a,b>, or reference concrete ${packagesDir}/<name>/ paths in the plan.`,
			});
		}

		await update({
			packages: declared,
			packagesSource: fromFlag ? PackagesSource.Flag : fromFrontMatter ? PackagesSource.FrontMatter : PackagesSource.PlanPaths,
		});
	}

	if (run.current().packages.length > 0) {
		progress(`package scope: ${run.current().packages.join(', ')} (from ${run.current().packagesSource ?? 'manifest'})`);
	}

	// Standards resolve AFTER scope: the bundled defaults are channelled —
	// base docs always, framework docs (react, tanstack) only when the scoped
	// packages' dependencies say the framework is in play, so a backend run
	// never pays the React-docs token tax. Config `standardsChannels`
	// replaces detection. Unspecified standards = the bundled defaults
	// (announced, never silent); `false` = explicitly none; an array =
	// exactly what it says.
	const standardsPaths = config.standards === false ? [] : (config.standards ?? ['lightsout:code-defaults']);
	const testStandardsPaths = config.testStandards === false ? [] : (config.testStandards ?? ['lightsout:test-defaults']);
	const channels =
		config.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir, packages: run.current().packages }));

	if (standardsPaths.length > 0 || testStandardsPaths.length > 0) {
		progress(
			`standards channels: base${channels.length > 0 ? ` + ${channels.join(' + ')}` : ''} (${config.standardsChannels ? 'configured' : 'detected from package dependencies'})`,
		);
	}

	let standards: string | undefined;
	let testStandards: string | undefined;

	try {
		standards = await readStandards({ cwd, paths: standardsPaths, channels });
		testStandards = await readStandards({ cwd, paths: testStandardsPaths, channels });
	} catch (error) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: error instanceof Error ? error.message : String(error),
		});
	}


	/** This run's packagesDir bound onto the shared mapper. */
	const packageDirOf = (file: string) => packageOf({ file, packagesDir });

	// Agents in a consumer nested inside a larger git repo sometimes echo
	// repo-ROOT-relative paths — computed once, threaded into every derivation
	// that normalizes report paths.
	const gitPrefix = await readGitPrefix({ cwd });

	// The shared derivations, bound to this run (their files own the logic).
	const collectChanged = (reports: WorkReport[]) => collectChangedFor({ run, gitPrefix, reports });
	const withStepFiles = ({ record, reports }: { record: StepRecord; reports: WorkReport[] }) => withStepFilesFor({ record, reports, gitPrefix });
	const gates = ({ coverage }: { coverage?: boolean }) => gatesFor({ run, coverage });
	const sourceFiles = () => sourceFilesFor({ run });

	const cleanSlateStep: PipelineStep['run'] = async () => {
		const record = nextRecord({ id: 'clean-slate' });

		await setStep({ record });
		progress(`step clean-slate — attempt ${record.attempts}`);

		// Coverage runs here too: verify-tests holds the same bar later, so a
		// baseline that already misses it must be the consumer's problem, not
		// the run's.
		const error = await gates({ coverage: true });

		if (error) {
			return stop({
				record,
				status: RunStatus.Failed,
				error: `Codebase is not green before implementation — fix this first.\n${error}`,
			});
		}

		// Gate commands may produce artifacts (coverage output, logs). Fold
		// anything that appeared during clean-slate into the baseline so it is
		// never attributed to the run's agents.
		const gateArtifacts = await readGitChangedFiles({ cwd });

		await setStep({
			record: { ...record, status: RunStatus.Passed },
			patch: gateArtifacts
				? { baselineDirtyFiles: [...new Set([...run.current().baselineDirtyFiles, ...gateArtifacts])] }
				: undefined,
		});
		progress('step clean-slate passed');

		return undefined;
	};

	// Inert-file filter for the write-tests fan-out: barrels and type-only
	// files provably hold no executable code, so a writer per file is a
	// guaranteed no-op spawn (or worse, an implementation-coupled test the
	// standards forbid). Classification borrows the consumer's TypeScript,
	// exactly like the scan's AST tier; without one, nothing is filtered —
	// the degraded path is today's behavior, never a lost writer.
	const selectTestTargets = async ({ candidates, compiler }: { candidates: string[]; compiler: ReturnType<typeof resolveConsumerTypescript> }) => {
		if (!compiler) {
			return { targets: candidates, inert: [] as string[] };
		}

		const targets: string[] = [];
		const inert: string[] = [];

		for (const file of candidates) {
			const content = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

			// Unreadable (deleted mid-run) keeps its writer — same as before.
			if (content !== undefined && isInertSourceFile({ path: file, content, compiler })) {
				inert.push(file);
			} else {
				targets.push(file);
			}
		}

		return { targets, inert };
	};

	// One writer per import-graph component, not per file: files that changed
	// together AND import each other are one test-writing job — the only
	// grouping that puts a boundary and its internals in the same writer's
	// hands (so "cover internals through the public surface" is possible on
	// the FIRST pass), while unrelated changes stay parallel. The engine only
	// groups; the agent, holding the injected standards, classifies within.
	// Components never cross packages, so partition by packageOf first.
	// Without a consumer TypeScript, groups degrade to one file each —
	// exactly the old fan-out.
	const groupTestTargets = async ({ targets, compiler }: { targets: string[]; compiler: ReturnType<typeof resolveConsumerTypescript> }) => {
		if (!compiler) {
			return targets.map((file) => [file]);
		}

		const byPackage = new Map<string, string[]>();

		for (const file of targets) {
			const key = packageDirOf(file) ?? '';

			byPackage.set(key, [...(byPackage.get(key) ?? []), file]);
		}

		const groups: string[][] = [];

		for (const partition of [...byPackage.keys()].sort()) {
			const partitionFiles = byPackage.get(partition) ?? [];
			const edges = await collectImportEdges({ cwd, files: partitionFiles, compiler });

			for (const component of groupConnectedFiles({ files: partitionFiles, edges })) {
				if (component.length > maxWriterGroupFiles) {
					progress(`write-tests: import component of ${component.length} files exceeds the ${maxWriterGroupFiles}-file writer cap — splitting into sorted chunks`);
				}

				groups.push(...chunkFileGroup({ files: component, max: maxWriterGroupFiles }));
			}
		}

		return groups;
	};

	const writeTestsStep: PipelineStep['run'] = async () => {
		let record = nextRecord({ id: 'write-tests' });

		await setStep({ record });

		// One writer per import-graph group, batches run in parallel — groups
		// are disjoint file sets, so writers cannot collide on disk.
		const compiler = resolveConsumerTypescript({ cwd, packagesDir });
		const { targets, inert } = await selectTestTargets({ candidates: sourceFiles(), compiler });

		if (inert.length > 0) {
			progress(`write-tests: ${inert.length} inert file(s) skipped (barrel/type-only, nothing to cover): ${inert.join(', ')}`);
		}

		const groups = await groupTestTargets({ targets, compiler });

		progress(
			`step write-tests — attempt ${record.attempts} · ${groups.length} group(s) across ${targets.length} file(s) (import-graph), up to ${testWriterConcurrency} writers in parallel`,
		);
		const reports: WorkReport[] = [];
		const failures: string[] = [];
		let terminated = false;
		let parked = false;

		for (let start = 0; start < groups.length && !parked; start += testWriterConcurrency) {
			const batch = groups.slice(start, start + testWriterConcurrency);
			const results = await Promise.all(
				batch.map(async (group) => ({
					group,
					...(await run.invokeRole({ invocation: buildUnitTestWriterInvocation({ planContent, changedFiles: group, standards: testStandards }), step: 'write-tests' })),
				})),
			);

			for (const result of results) {
				const label = result.group.join(', ');

				if (result.rateLimited) {
					parked = true;
					continue;
				}

				if (!result.report) {
					failures.push(`${label}: ${result.failure ?? 'unknown failure'}`);
					continue;
				}

				await appendFriction({ cwd, runId: run.current().runId, step: 'write-tests', friction: result.report.friction ?? [] });
				reports.push(result.report);
				progress(`write-tests: ${label} — ${result.report.status}`);

				if (result.report.status !== WorkReportStatus.Complete) {
					terminated = terminated || result.report.status !== WorkReportStatus.Failed;
					failures.push(`${label}: ${result.report.status} — ${result.report.failures.join('; ')}`);
				}
			}
		}

		// Persist whatever progress the batches made before deciding the
		// outcome — a parked or stopped run must still know what was touched.
		record = withStepFiles({ record, reports });

		await setStep({ record: { ...record, report: { reports } }, patch: await collectChanged(reports) });

		if (parked) {
			return stop({ record: { ...record, report: { reports } }, status: RunStatus.PausedRateLimit, error: parkMessage() });
		}

		if (failures.length > 0) {
			return stop({
				record: { ...record, report: { reports } },
				status: terminated ? RunStatus.Escalated : RunStatus.Failed,
				error: `write-tests: ${failures.length} of ${groups.length} writer(s) did not complete:\n${failures.join('\n')}`,
			});
		}

		await setStep({ record: { ...record, status: RunStatus.Passed, report: { reports } } });
		progress('step write-tests passed');

		return undefined;
	};

	// The scan gate's work-list: deterministic findings touching this run's
	// changed files (baseline-suppressed when a ledger exists). Never asks
	// the agent to "go find problems" — detection is code.
	const scanWorkList = async () => {
		const { findings } = await runScan({ cwd, persist: false });

		return selectScanFindings({ findings, changedFiles: sourceFiles() });
	};

	// Escalations are read by a human deciding what to do next — the message
	// must carry the evidence (what persists, where) and the agent's own
	// account of why it left the findings, not just opaque cluster ids that
	// send the reader digging through friction.jsonl.
	const describePersistingFindings = ({ gating, report, passes }: { gating: ScanFinding[]; report?: WorkReport; passes: number }) => {
		const findingLines = gating.map((finding) => {
			const where = finding.files.map((file) => formatFindingSite({ file })).join(', ');

			return `- ${finding.cluster} — ${finding.detail}\n  at ${where}`;
		});
		const rationale = (report?.friction ?? []).map((entry) => `- [${entry.area}] ${entry.detail}`);

		return [
			`refactor: scan gate — ${gating.length} finding(s) persist after ${passes} pass(es):`,
			...findingLines,
			...(rationale.length > 0 ? ["the refactor agent's account of its final pass:", ...rationale] : []),
		].join('\n');
	};

	const refactorStep: PipelineStep['run'] = async () => {
		let record = nextRecord({ id: 'refactor' });
		let lastReport: WorkReport | undefined;
		let cleanExit = false;

		// Gating cluster set of the last no-change pass. When the next pass
		// declines the IDENTICAL set, the disagreement is stable — the agent
		// has judged, the scanner cannot hear judgment, and a further pass
		// only re-buys the same answer. Reset by any pass that changes files.
		let lastDeclined: string | undefined;

		// Iterate until a pass reports complete with zero changed files AND the
		// scanner reports no gating findings on the changed files — capped at
		// maxRefactorPasses.
		for (let pass = 1; pass <= maxRefactorPasses; pass += 1) {
			await setStep({ record });

			const scan = await scanWorkList();

			if (scan.workList.length > 0 || scan.advisories.length > 0) {
				progress(
					`scan gate: ${scan.workList.length} finding(s) + ${scan.advisories.length} advisory(ies) on changed files${scan.gating.length > 0 ? ` (${scan.gating.length} gating)` : ''}`,
				);
			}

			progress(`step refactor — pass ${pass}/${maxRefactorPasses}`);

			const { report, failure, rateLimited } = await run.invokeRole({
				invocation: buildRefactorExecutorInvocation({
					planContent,
					changedFiles: sourceFiles(),
					standards,
					scanFindings: scan.workList,
					scanAdvisories: scan.advisories,
				}),
				step: 'refactor',
			});

			if (rateLimited) {
				return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
			}

			if (!report) {
				return stop({ record, status: RunStatus.Failed, error: failure ?? 'unknown failure' });
			}

			await appendFriction({ cwd, runId: run.current().runId, step: 'refactor', friction: report.friction ?? [] });

			if (report.status !== WorkReportStatus.Complete) {
				const status = report.status === WorkReportStatus.Failed ? RunStatus.Failed : RunStatus.Escalated;

				return stop({ record: { ...record, report }, status, error: `refactor: ${report.status} — ${report.failures.join('; ')}` });
			}

			record = withStepFiles({ record, reports: [report] });

			await setStep({ record: { ...record, report }, patch: await collectChanged([report]) });
			lastReport = report;

			if (report.changedFiles.length === 0) {
				// No changes this pass, so the top-of-pass scan still describes
				// the tree — no re-scan needed to judge the gate.
				if (scan.gating.length === 0) {
					progress(`refactor pass ${pass}: no changes — loop complete`);
					cleanExit = true;
					break;
				}

				const declined = scan.gating
					.map((finding) => finding.cluster)
					.sort()
					.join('\n');

				if (declined === lastDeclined && pass < maxRefactorPasses) {
					progress(`refactor pass ${pass}: agent declined the same gating set twice — escalating without spending the remaining pass(es)`);
				}

				if (pass === maxRefactorPasses || declined === lastDeclined) {
					return stop({
						record: { ...record, report },
						status: RunStatus.Escalated,
						error: describePersistingFindings({ gating: scan.gating, report, passes: pass }),
					});
				}

				lastDeclined = declined;
				progress(`refactor pass ${pass}: no changes but scanner still reports ${scan.gating.length} gating finding(s) — another pass`);
				record = { ...record, attempts: record.attempts + 1 };
				continue;
			}

			// The tree changed — the next scan is a fresh question, not a repeat.
			lastDeclined = undefined;
			progress(`refactor pass ${pass}: ${report.changedFiles.length} change(s)`);
			record = { ...record, attempts: record.attempts + 1 };
		}

		// The loop can also exhaust its passes while still reporting changes —
		// the gate must not be escapable through that exit.
		if (!cleanExit) {
			const final = await scanWorkList();

			if (final.gating.length > 0) {
				return stop({
					record: { ...record, report: lastReport },
					status: RunStatus.Escalated,
					error: describePersistingFindings({ gating: final.gating, report: lastReport, passes: maxRefactorPasses }),
				});
			}
		}

		await setStep({ record: { ...record, status: RunStatus.Passed, report: lastReport } });
		progress('step refactor passed');

		return undefined;
	};

	const formatStep: PipelineStep = {
		id: 'format',
		skip: () => (config.scripts.format ? undefined : 'no format command configured'),
		run: async () => {
			const formatCommand = config.scripts.format;

			if (!formatCommand) {
				return undefined;
			}

			const record = nextRecord({ id: 'format' });

			await setStep({ record });
			progress('step format — running formatter');

			const startedAt = Date.now();
			let result;

			try {
				result = await runCommand({ command: formatCommand, cwd, timeoutMs: formatTimeoutMs });
			} catch (error) {
				// A formatter that times out or fails to spawn is a red step, not a crash.
				result = { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
			}

			await appendCommandLog({
				cwd,
				runId: run.current().runId,
				record: {
					at: new Date().toISOString(),
					step: 'format',
					group: 'root',
					kind: 'format',
					command: formatCommand,
					exitCode: result.exitCode,
					durationMs: Date.now() - startedAt,
					...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-2000) }),
				},
			});

			if (result.exitCode !== 0) {
				return stop({
					record,
					status: RunStatus.Failed,
					error: `format failed (exit ${result.exitCode}):\n${result.stdout}\n${result.stderr}`,
				});
			}

			// A formatter should be behavior-preserving — verify anyway; a red
			// gate here means the formatter and the checks disagree, which is a
			// human's configuration problem, not an agent's.
			const error = await gates({ coverage: true });

			if (error) {
				return stop({ record, status: RunStatus.Failed, error: `format: formatting broke verification — review the formatter/gate configuration.\n${error}` });
			}

			// No changed-file merge here: the formatter only rewrites files the
			// run already tracks, and anything new it emits is artifact noise.
			await setStep({ record: { ...record, status: RunStatus.Passed } });
			progress('step format passed');

			return undefined;
		},
	};

	const refactorSteps: PipelineStep[] = skipRefactor
		? []
		: [
				{
					id: 'refactor',
					skip: () => (sourceFiles().length === 0 ? 'no changed source files to review' : undefined),
					run: refactorStep,
				},
				{
					id: 'verify-refactor',
					run: verifyStep({
						run,
						gitPrefix,
						planContent,
						id: 'verify-refactor',
						coverage: true,
						buildFix: (errorContext) =>
							buildRefactorExecutorInvocation({ planContent, changedFiles: sourceFiles(), standards, errorContext }),
					}),
				},
			];

	const steps: PipelineStep[] = [
		{ id: 'clean-slate', run: cleanSlateStep },
		{
			id: 'implement',
			run: workStep({
				run,
				gitPrefix,
				id: 'implement',
				requireChanges: true,
				build: () => buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands: config.agentCommands }),
			}),
		},
		{
			id: 'verify-implement',
			run: verifyStep({
				run,
				gitPrefix,
				planContent,
				id: 'verify-implement',
				buildFix: (errorContext) =>
					buildFeatureExecutorInvocation({
						planContent,
						overviewContent,
						standards,
						errorContext,
						changedFiles: run.current().changedFiles,
						allowedCommands: config.agentCommands,
					}),
			}),
		},
		{
			id: 'write-tests',
			skip: () => (sourceFiles().length === 0 ? 'no eligible source files' : undefined),
			run: writeTestsStep,
		},
		{
			id: 'verify-tests',
			run: verifyStep({
				run,
				gitPrefix,
				planContent,
				id: 'verify-tests',
				coverage: true,
				buildFix: (errorContext) =>
					buildUnitTestWriterInvocation({ planContent, changedFiles: sourceFiles(), standards: testStandards, errorContext }),
			}),
		},
		...refactorSteps,
		formatStep,
	];

	await update({ status: RunStatus.Running });

	for (const step of steps) {
		const prior = run.current().steps.find((record) => record.id === step.id);

		if (prior?.status === RunStatus.Passed) {
			continue;
		}

		const skipReason = step.skip?.();

		if (skipReason) {
			await setStep({
				record: { id: step.id, status: RunStatus.Passed, attempts: prior?.attempts ?? 0, report: { skipped: skipReason } },
			});
			progress(`step ${step.id} skipped (${skipReason})`);

			continue;
		}

		const stopped = await step.run();

		if (stopped) {
			return stopped;
		}
	}

	await update({ status: RunStatus.Passed, currentStep: null });

	const passed: PipelineResult = { ok: true, manifest: run.current() };

	return passed;
};

/**
 * Public entry: the shared run-lock lifecycle around the pipeline body —
 * acquisition happens before ANY disk write, every exit path releases, and
 * the refactor pipeline takes the same repo lock, so the two can never race
 * one tree.
 */
export const runImplementPipeline = (params: Params): Promise<PipelineResult> => withRunLock({ params, run: executePipeline });
