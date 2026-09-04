import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildLedgerTestWriterInvocation } from '#src/agents/index.ts';
import { readGitCommittedFile } from '#src/common/git/readGitCommittedFile.ts';
import { runFormatter } from '#src/common/processes/runFormatter.ts';
import { type LedgerRow, RunStatus, type WorkReport } from '#src/contracts/index.ts';
import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import type { WriterResult } from '#src/pipeline/common/types/WriterResult.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { createWarmSpawn } from '#src/pipeline/common/utils/createWarmSpawn.ts';
import { createWriterAggregate } from '#src/pipeline/common/utils/createWriterAggregate.ts';
import { drainChains } from '#src/pipeline/common/utils/drainChains.ts';
import { lockLedgerTests } from '#src/pipeline/common/utils/lockLedgerTests.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';

const stepId = 'write-ledger-tests';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	overviewContent?: string;
	/** The plan's ledger. An empty ledger skips the step before this runs. */
	rows: LedgerRow[];
	testStandards?: string;
}

/** One writer's assignment: the test file it owns, and every ledger row naming it. */
interface LedgerAssignment {
	testFile: string;
	rows: LedgerRow[];
}

/** What every ledger writer's brief needs, minus the per-assignment part. */
type Context = Omit<Params, 'rows' | 'gitPrefix'>;

/** What the two writer passes produced, and the stop they earned when they did not settle. */
interface LedgerWriteOutcome {
	reports: WorkReport[];
	failure?: { status: RunStatus; error: string };
}

// First-appearance order, so the warm-up spawn owns the ledger's first file.
const groupRows = ({ rows }: { rows: LedgerRow[] }) => {
	const byFile = new Map<string, LedgerRow[]>();

	for (const row of rows) {
		byFile.set(row.testFile, [...(byFile.get(row.testFile) ?? []), row]);
	}

	return [...byFile].map(([testFile, fileRows]) => ({ testFile, rows: fileRows }));
};

// The writer uses the ledger's name verbatim as the test's name string, so presence is exactly that string under either quote.
const isNamePresent = ({ content, name }: { content: string; name: string }) => content.includes(`'${name}'`) || content.includes(`"${name}"`);

const namesOf = ({ assignment }: { assignment: LedgerAssignment }) => assignment.rows.map((row) => row.testName);

/** Assigned names a file already carries AS COMMITTED — never the working tree, so a re-entry after a park reads the same verdict as the first pass. One line per offending file. */
const committedConflicts = async ({ run, assignments }: { run: PipelineRun; assignments: LedgerAssignment[] }) => {
	const found = await Promise.all(
		assignments.map(async (assignment) => {
			const content = await readGitCommittedFile({ cwd: run.cwd, path: assignment.testFile });
			const names = content === undefined ? [] : namesOf({ assignment }).filter((name) => isNamePresent({ content, name }));

			return { testFile: assignment.testFile, names };
		}),
	);

	return found.filter(({ names }) => names.length > 0).map(({ testFile, names }) => `${testFile}: ${names.join(', ')}`);
};

/** Assigned names absent from the file on disk; undefined when the file itself is absent. */
const missingNames = async ({ run, assignment }: { run: PipelineRun; assignment: LedgerAssignment }) => {
	const content = await readFile(join(run.cwd, assignment.testFile), 'utf8').catch(() => undefined);

	return content === undefined ? undefined : namesOf({ assignment }).filter((name) => !isNamePresent({ content, name }));
};

interface SpawnParams {
	context: Context;
	group: LedgerAssignment;
	onFirstEvent?: () => void;
	/** Missing-test names, on the single repair re-invocation. */
	errorContext?: string;
}

const spawnLedgerWriter = async ({ context, group, onFirstEvent, errorContext }: SpawnParams): Promise<WriterResult<LedgerAssignment>> => ({
	group,
	...(await context.run.invokeRole({
		invocation: buildLedgerTestWriterInvocation({
			planContent: context.planContent,
			overviewContent: context.overviewContent,
			testFile: group.testFile,
			rows: group.rows,
			standards: context.testStandards,
			errorContext,
		}),
		step: stepId,
		onFirstEvent,
	})),
});

// Assignments own disjoint files, so every one of them is a chain of one.
const runLedgerWriters = async ({ context, assignments }: { context: Context; assignments: LedgerAssignment[] }) => {
	const aggregate = createWriterAggregate<LedgerAssignment>({ run: context.run, step: stepId, label: ({ group }) => group.testFile });
	const spawnWriter = ({ group, onFirstEvent }: { group: LedgerAssignment; onFirstEvent?: () => void }) => spawnLedgerWriter({ context, group, onFirstEvent });
	const warmed = assignments.length > 1;
	const { collectWarm, awaitGate, isSettled } = createWarmSpawn({ group: warmed ? assignments[0] : undefined, spawnWriter, aggregate });

	await awaitGate();

	const chains = (warmed ? assignments.slice(1) : assignments).map((group) => async () => [await spawnWriter({ group })]);

	if (isSettled()) {
		await collectWarm();
	}

	await drainChains({ chains, aggregate, collectWarm, isSettled });
	await collectWarm();

	return aggregate.result();
};

/** Every assigned name accounted for, with one re-invocation per file that is short — after the lock no agent may touch the file, so this is the only place a missing name can be repaired. */
const settleWrittenTests = async ({ context, assignments }: { context: Context; assignments: LedgerAssignment[] }) => {
	const reports: WorkReport[] = [];
	const errors: string[] = [];
	let parked = false;

	for (const assignment of assignments) {
		const missing = await missingNames({ run: context.run, assignment });

		if (missing?.length === 0) {
			continue;
		}

		if (missing === undefined) {
			errors.push(`${assignment.testFile}: the writer reported complete but wrote no such file`);

			continue;
		}

		context.run.progress(`${stepId}: ${assignment.testFile} — ${missing.length} named test(s) missing, re-invoking its writer once`);

		const result = await spawnLedgerWriter({ context, group: assignment, errorContext: missing.map((name) => `- \`${name}\``).join('\n') });

		if (!result.ok) {
			parked = parked || result.rateLimited;
			errors.push(...(result.rateLimited ? [] : [`${assignment.testFile}: ${result.failure}`]));

			continue;
		}

		reports.push(result.report);

		const stillMissing = (await missingNames({ run: context.run, assignment })) ?? namesOf({ assignment });

		errors.push(...(stillMissing.length === 0 ? [] : [`${assignment.testFile}: still missing ${stillMissing.join(', ')}`]));
	}

	return { reports, errors, parked };
};

/** Both writer passes as one outcome: the fan-out, then the repair of any file short a named test. */
const writeLedgerTests = async ({ context, assignments }: { context: Context; assignments: LedgerAssignment[] }): Promise<LedgerWriteOutcome> => {
	const written = await runLedgerWriters({ context, assignments });
	// The repair pass is only owed to writers that all came back; a park or a failure below has already decided the step.
	const settled = written.parked || written.failures.length > 0 ? undefined : await settleWrittenTests({ context, assignments });
	const reports = [...written.reports, ...(settled?.reports ?? [])];
	let failure: LedgerWriteOutcome['failure'];

	if (written.parked || settled?.parked) {
		failure = { status: RunStatus.PausedRateLimit, error: context.run.parkMessage() };
	} else if (written.failures.length > 0) {
		failure = {
			status: written.terminated ? RunStatus.Escalated : RunStatus.Failed,
			error: `${stepId}: ${written.failures.length} of ${assignments.length} writer(s) did not complete:\n${written.failures.join('\n')}`,
		};
	} else if (settled && settled.errors.length > 0) {
		failure = {
			status: RunStatus.Failed,
			error: `${stepId}: the ledger's named test(s) are not in place after a repair pass:\n${settled.errors.join('\n')}`,
		};
	}

	return { reports, failure };
};

/**
 * The write-ledger-tests fan-out: one writer per ledger test file, then the
 * lock. The tests stating the plan's acceptance criteria are written before the
 * executor starts and copied into the run folder, so the party being verified
 * never edits the verifier.
 */
export const writeLedgerTestsStep = ({ run, gitPrefix, planContent, overviewContent, rows, testStandards }: Params): PipelineStep['run'] => {
	const context: Context = { run, planContent, overviewContent, testStandards };

	return async () => {
		let record = run.nextRecord({ id: stepId });

		await run.setStep({ record });

		const assignments = groupRows({ rows });
		const conflicts = await committedConflicts({ run, assignments });

		if (conflicts.length > 0) {
			return run.stop({
				record,
				status: RunStatus.Failed,
				error: `${stepId}: the ledger names test(s) the committed file already carries — a test written for older behaviour cannot be locked as a new criterion's verifier:\n${conflicts.join('\n')}`,
			});
		}

		run.progress(
			`step ${stepId} — attempt ${record.attempts} · ${assignments.length} ledger test file(s), ${rows.length} named test(s), up to ${testWriterConcurrency} writers in parallel`,
		);

		const { reports, failure } = await writeLedgerTests({ context, assignments });

		record = withStepFiles({ record, reports, gitPrefix });
		await run.setStep({ record: { ...record, report: { reports } }, patch: await collectChanged({ run, gitPrefix, reports }) });

		if (failure) {
			return run.stop({ record: { ...record, report: { reports } }, ...failure });
		}

		// Formatted before hashing, so the lock is byte-exact and every later
		// format pass is a no-op on a locked file.
		const formatError = await runFormatter({ cwd: run.cwd, runId: run.current().runId, config: run.config, step: stepId });

		if (formatError) {
			return run.stop({ record: { ...record, report: { reports } }, status: RunStatus.Failed, error: formatError });
		}

		const ledgerTests = await lockLedgerTests({
			run,
			files: assignments.map((assignment) => ({ path: assignment.testFile, testNames: namesOf({ assignment }) })),
		});

		await run.setStep({ record: { ...record, status: RunStatus.Passed, report: { reports } }, patch: { ledgerTests } });
		run.progress(`step ${stepId} passed — ${ledgerTests.length} ledger test file(s) locked`);

		return undefined;
	};
};
