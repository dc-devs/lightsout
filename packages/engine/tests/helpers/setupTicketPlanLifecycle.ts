import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { jest } from '@jest/globals';
import { type PlanProgress, type RunManifest, RunStatus, TicketEventKind, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { planWorkspacePath } from '#src/plan/index.ts';
import { updateLocalTicketRecord } from '#src/ticket/index.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';

/** What a test file's `jest.mock` of the git module hands this fixture to answer HEAD with. */
export type MockedReadGitHeadCommit = jest.Mock<(params: { cwd: string }) => Promise<string | undefined>>;

/** The ticket folder's name, which is also the branch every record below names. */
export const ticketBranch = 'lo-140-multi';
export const firstPlan = '001-lifecycle';
export const secondPlan = '002-queue-order';
export const address = `${ticketBranch}/${firstPlan}`;
/** What `git rev-parse HEAD` answers in the checkout a run builds in. */
export const headCommit = '9f1c0a7d3b6e4152a8c07d5b9e2f4a6c1d3e5f70';
/** Where the ticket branch stood when an earlier run of plan 001 began, before HEAD moved on. */
export const startCommit = '2b4d6f8a0c1e3557799bbddff13355779bbddff1';
/** A marker some other machine published: 64 lowercase hex characters, as both the record and the sidecar spell one. */
export const otherMachineMarker = '0f'.repeat(32);

export const planBody = '# The lifecycle helper\n';
const overviewBody = '# The lifecycle helper — overview\n';
const phaseBody = '# Phase 1\n';
export const decisionsBody = '[{"id":1}]\n';

export const planOf = ({
	id,
	progress,
	implementation,
	publishedMarker,
}: {
	id: string;
	progress: PlanProgress;
	implementation?: TicketPlan['implementation'];
	publishedMarker?: string;
}): TicketPlan => ({
	id,
	title: `plan ${id}`,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	implementation,
	publishedMarker,
});

const recordOf = ({ mode, plans }: { mode: TicketMode; plans: TicketPlan[] }): TicketRecord => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode,
	plans,
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: TicketEventKind.PlanAdded, detail: `added plan ${firstPlan}` }],
});

/** The manifest a pipeline hands back, written by hand so a row can pin a shape no convenient real run produces. */
export const manifestOf = ({ name, runId, status, plan }: { name: string; runId: string; status: RunStatus; plan?: string }): RunManifest => ({
	runId,
	createdAt: '2026-03-01T00:00:00.000Z',
	updatedAt: '2026-03-01T00:10:00.000Z',
	plan: plan ?? `${planWorkspacePath({ name })}/plan.md`,
	harness: 'claude-code',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

interface LifecycleSetup {
	/** The mocked `readGitHeadCommit`, hoisted per test file by `jest.mock`, so this fixture can answer it and hook the window before the locked write. */
	mockReadGitHeadCommit: MockedReadGitHeadCommit;
	/** What the run is asked for: a plan address, or a legacy plan folder's name. */
	name?: string;
	/** The plans the ticket record holds. Omitted entirely, no record is written at all. */
	plans?: TicketPlan[];
	mode?: TicketMode;
	/** The sidecar's per-plan markers, written as `ticket-sync.json`. Omitted, no sidecar is written. */
	planMarkers?: Record<string, string>;
	/** The plan's own files: a single `plan.md`, or an `overview.md` with one phase file beside it. */
	folder?: 'single' | 'phased';
	/** The commit HEAD is at, or undefined when git cannot name one. */
	head?: string;
	/** The status the pipeline's manifest ends at. */
	status?: RunStatus;
	/** The manifest's plan path, defaulting to the plan folder's own `plan.md`. */
	manifestPlan?: string;
	/** Runs the moment the pipeline starts — how a row deletes the record out from under a finishing run. */
	onRun?: (context: { recordPath: string }) => void;
	/** Runs between the record's first read and the locked write that marks the plan implementing — how a row changes the record inside that window. */
	onStart?: (context: { cwd: string; recordPath: string }) => Promise<void>;
	/** Whether the written record is then replaced by bytes that are not a record at all. */
	corrupt?: boolean;
}

/**
 * A checkout outside any repository, so the shared state directory is this
 * directory's own `.lightsout` and the ticket folder is a path the row can
 * name, holding the plan's files and — where the row asks for one — a record
 * written by the store itself, so its bytes are the ones a real machine holds.
 */
export const setupTicketPlanLifecycle = async (setup: LifecycleSetup) => {
	const {
		mockReadGitHeadCommit,
		name = address,
		plans,
		mode = TicketMode.MultiplePlan,
		planMarkers,
		folder = 'single',
		status = RunStatus.Passed,
		manifestPlan,
		onRun,
		onStart,
		corrupt = false,
	} = setup;
	// Read through the key rather than a destructuring default, so the row that
	// says `head: undefined` gets no commit at all — a default would hand it one
	// back and it could never reach the refusal it names.
	const head = 'head' in setup ? setup.head : headCommit;
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-lifecycle-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);
	const recordPath = join(ticketFolder, 'ticket.json');
	const planFolder = planWorkspaceFolder({ cwd: cwd, name: name });

	// Reading HEAD is the one await between the record's first read and the locked
	// write that follows it, so a row that has to change the record inside that
	// window does it from here.
	mockReadGitHeadCommit.mockImplementation(async () => {
		await onStart?.({ cwd, recordPath });

		return head;
	});
	mkdirSync(planFolder, { recursive: true });
	writeFileSync(join(planFolder, 'decisions.json'), decisionsBody);

	if (folder === 'single') {
		writeFileSync(join(planFolder, 'plan.md'), planBody);
	} else {
		writeFileSync(join(planFolder, 'overview.md'), overviewBody);
		writeFileSync(join(planFolder, 'phase1-lifecycle.md'), phaseBody);
	}

	if (plans !== undefined) {
		await updateLocalTicketRecord({ cwd, ticketBranch, change: () => recordOf({ mode, plans }) });
	}

	if (planMarkers !== undefined) {
		mkdirSync(ticketFolder, { recursive: true });
		writeFileSync(join(ticketFolder, 'ticket-sync.json'), JSON.stringify({ schemaVersion: 1, planMarkers }));
	}

	if (corrupt) {
		writeFileSync(recordPath, '{ half a record');
	}

	const readRecord = () => JSON.parse(readFileSync(recordPath, 'utf8')) as TicketRecord;
	const seenRunIds: string[] = [];
	/** The record as it stood the moment the pipeline started, which is what "before the run" is asserted against. */
	const recordsAtRunStart: (TicketRecord | undefined)[] = [];
	const run = ({ runId }: { runId: string }): Promise<PipelineResult> => {
		seenRunIds.push(runId);
		recordsAtRunStart.push(existsSync(recordPath) ? readRecord() : undefined);
		onRun?.({ recordPath });

		return Promise.resolve({ ok: status === RunStatus.Passed, manifest: manifestOf({ name, runId, status, plan: manifestPlan }) });
	};

	return { cwd, name, recordPath, seenRunIds, recordsAtRunStart, run, readRecord };
};
