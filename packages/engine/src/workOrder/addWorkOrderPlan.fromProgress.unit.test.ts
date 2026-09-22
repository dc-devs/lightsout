import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerAttachment, TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { addWorkOrderPlan } from '#src/workOrder/index.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam. The source folder's loose files, its run
// manifests and the record itself are real files in a temporary checkout,
// because what these rows promise is which progress value reaches the record
// from what the source folder holds.
const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();
/** What `setTicketAttachment` takes, named so the mock and its wrapper each read on one line. */
type AttachmentWrite = { settings: TrackerSettings; ticketId: string; title: string; content: Buffer; contentType: string };

const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config }: { config: LightsoutConfig }): TrackerSettings | TrackerFailure =>
		config['ticket-tracker'] === undefined
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

/** The work order's label, which every row below also names as the source folder `--from` points at. */
const name = 'lo-157-from-progress';
const slug = 'search-basics';
const planId = '001-search-basics';
const address = `${name}/${planId}`;
/** A repository with no tracker at all, so the record stays local and nothing is published. */
const localOnlyConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const env = { LINEAR_API_KEY: 'lin_key' };

const planBody = '# the drafted plan of lo-157\n';
const notesBody = '# brainstorm notes of lo-157\n';
/** A source folder holding a drafted plan, which is what separates ready to implement from still being planned. */
const draftedPlanFiles: Record<string, string> = { 'plan.md': planBody, 'decisions.json': '{\n\t"decisions": []\n}\n' };
/** Where a run manifest says it built, in the spelling a manifest carries. */
const planPathIn = ({ ticket = name, file = 'plan.md' }: { ticket?: string; file?: string } = {}) => `.lightsout/tickets/${ticket}/plans/${file}`;
/** The day every seeded run is dated, which is after the source folder's own files. */
const runDay = '2026-01-02T00:00:00.000Z';

interface RunSeed {
	runId: string;
	/** A `RunStatus` value, as the manifest spells it. */
	status: string;
	/** The repo-relative plan path the run built, the source folder's own plan by default. */
	plan?: string;
	/** The plan the run recorded as the one it belongs to, the source folder by default. */
	planName?: string;
	pipeline?: string;
	/** Set on a phase's child run: the coordinator that started it. */
	parentRunId?: string;
	createdAt?: string;
}

interface SetupParams {
	/** The loose files the source's plans folder holds, by name and body. */
	looseFiles?: Record<string, string>;
	runs?: RunSeed[];
}

/**
 * A temporary checkout belonging to no repository, so its own `.lightsout` is
 * the primary one: a work order folder whose plans folder holds the loose files the
 * row gives it, and the run records the row seeds under that same folder.
 */
const setupSourceProgress = ({ looseFiles = draftedPlanFiles, runs = [] }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-add-plan-from-progress-'));
	const workOrderFolder = join(cwd, '.lightsout', 'tickets', name);

	mkdirSync(join(workOrderFolder, 'plans'), { recursive: true });

	for (const [name, body] of Object.entries(looseFiles)) {
		writeFileSync(join(workOrderFolder, 'plans', name), body);
	}

	for (const run of runs) {
		const runDir = runDirFor({ cwd, runId: run.runId, planName: run.planName ?? name });
		const manifest = {
			runId: run.runId,
			createdAt: run.createdAt ?? runDay,
			updatedAt: run.createdAt ?? runDay,
			plan: run.plan ?? planPathIn(),
			planName: run.planName ?? name,
			pipeline: run.pipeline ?? 'implement',
			parentRunId: run.parentRunId,
			harness: 'claude',
			status: run.status,
			currentStep: null,
			steps: [],
			changedFiles: [],
		};

		mkdirSync(runDir, { recursive: true });
		writeFileSync(join(runDir, 'manifest.json'), `${JSON.stringify(manifest, undefined, '\t')}\n`);
	}

	mockGetTicketAttachments.mockResolvedValue([]);
	mockGetTicketsByIdentifiers.mockResolvedValue([]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return { cwd, workOrderFolder, params: { cwd, name, slug, from: name, config: localOnlyConfig, env } };
};

/** The progress the record on disk carries for the plan the add made, which is what every later command reads. */
const progressOf = ({ workOrderFolder }: { workOrderFolder: string }) => {
	const record = JSON.parse(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')) as WorkOrderState;

	return record.plans.at(0)?.progress;
};

describe('addWorkOrderPlan', () => {
	test("takes the plan's progress from whether the source holds a plan deliverable", async () => {
		const drafted = setupSourceProgress();
		const working = setupSourceProgress({ looseFiles: { 'brainstorm-notes.md': notesBody } });

		const afterDrafted = await addWorkOrderPlan(drafted.params);
		const afterWorking = await addWorkOrderPlan(working.params);

		expect({ drafted: afterDrafted, working: afterWorking }).toEqual({
			drafted: expect.objectContaining({ address }),
			working: expect.objectContaining({ address }),
		});
		expect({
			drafted: progressOf({ workOrderFolder: drafted.workOrderFolder }),
			working: progressOf({ workOrderFolder: working.workOrderFolder }),
		}).toStrictEqual({ drafted: 'ready', working: 'planning' });
	});

	test('a passed run of the source wins over the latest run that did not pass', async () => {
		const builtThenRepaired = setupSourceProgress({
			runs: [
				{ runId: 'run-passed', status: 'passed' },
				{ runId: 'run-repair', status: 'failed', createdAt: '2026-01-03T00:00:00.000Z' },
			],
		});
		const failedOnly = setupSourceProgress({ runs: [{ runId: 'run-failed', status: 'failed' }] });

		const afterBuiltThenRepaired = await addWorkOrderPlan(builtThenRepaired.params);
		const afterFailedOnly = await addWorkOrderPlan(failedOnly.params);

		expect({ builtThenRepaired: afterBuiltThenRepaired, failedOnly: afterFailedOnly }).toEqual({
			builtThenRepaired: expect.objectContaining({ address }),
			failedOnly: expect.objectContaining({ address }),
		});
		expect({
			builtThenRepaired: progressOf({ workOrderFolder: builtThenRepaired.workOrderFolder }),
			failedOnly: progressOf({ workOrderFolder: failedOnly.workOrderFolder }),
		}).toStrictEqual({ builtThenRepaired: 'implemented', failedOnly: 'failed' });
	});

	test('reads how far the source got from the plan each run recorded, not from its plan path', async () => {
		// The two plan paths are crossed over: the run that recorded this folder
		// points at another ticket's file, and the run that recorded another plan
		// of this same ticket points at this folder's own. Only the recorded name
		// may decide either answer.
		const recordedHere = setupSourceProgress({ runs: [{ runId: 'run-recorded-here', status: 'passed', plan: planPathIn({ ticket: 'lo-10-other' }) }] });
		const recordedElsewhere = setupSourceProgress({ runs: [{ runId: 'run-recorded-elsewhere', status: 'passed', planName: `${name}/001-earlier` }] });

		const afterRecordedHere = await addWorkOrderPlan(recordedHere.params);
		const afterRecordedElsewhere = await addWorkOrderPlan(recordedElsewhere.params);

		expect({ here: afterRecordedHere, elsewhere: afterRecordedElsewhere }).toEqual({
			here: expect.objectContaining({ address }),
			elsewhere: expect.objectContaining({ address }),
		});
		expect({
			here: progressOf({ workOrderFolder: recordedHere.workOrderFolder }),
			elsewhere: progressOf({ workOrderFolder: recordedElsewhere.workOrderFolder }),
		}).toStrictEqual({ here: 'implemented', elsewhere: 'ready' });
	});

	test("does not count a passed child run of a phased coordinator as the source's implementation", async () => {
		const { params, workOrderFolder } = setupSourceProgress({
			looseFiles: { 'overview.md': '# the overview of lo-157\n', 'phase1-a.md': '# phase 1\n' },
			runs: [
				{ runId: 'run-coordinator', status: 'failed', pipeline: 'phases', plan: planPathIn({ file: 'overview.md' }) },
				{
					runId: 'run-child',
					status: 'passed',
					parentRunId: 'run-coordinator',
					plan: planPathIn({ file: 'phase1-a.md' }),
					createdAt: '2026-01-03T00:00:00.000Z',
				},
			],
		});

		const result = await addWorkOrderPlan(params);

		expect(result).toEqual(expect.objectContaining({ address }));
		expect(progressOf({ workOrderFolder })).toBe('ready');
	});

	test('adds past a run that is no longer live and records how far its implementation got', async () => {
		const escalated = setupSourceProgress({ runs: [{ runId: 'run-escalated', status: 'escalated' }] });
		const paused = setupSourceProgress({ runs: [{ runId: 'run-paused', status: 'paused-rate-limit' }] });
		// A `running` manifest with no lock behind it: the leftover of a process
		// that died, which says the implementation started and never finished.
		const stale = setupSourceProgress({ runs: [{ runId: 'run-stale', status: 'running' }] });

		const afterEscalated = await addWorkOrderPlan(escalated.params);
		const afterPaused = await addWorkOrderPlan(paused.params);
		const afterStale = await addWorkOrderPlan(stale.params);

		expect({ escalated: afterEscalated, paused: afterPaused, stale: afterStale }).toEqual({
			escalated: expect.objectContaining({ address }),
			paused: expect.objectContaining({ address }),
			stale: expect.objectContaining({ address }),
		});
		expect({
			escalated: progressOf({ workOrderFolder: escalated.workOrderFolder }),
			paused: progressOf({ workOrderFolder: paused.workOrderFolder }),
			stale: progressOf({ workOrderFolder: stale.workOrderFolder }),
		}).toStrictEqual({ escalated: 'failed', paused: 'implementing', stale: 'implementing' });
	});
});
