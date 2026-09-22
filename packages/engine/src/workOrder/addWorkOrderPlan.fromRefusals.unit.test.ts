import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { TrackerAttachment, TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { addWorkOrderPlan } from '#src/workOrder/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam. The source folders, the loose files, the
// run manifests, the run lock and the record are real files in a temporary
// checkout, because what a refusal promises is that nothing on disk moved.
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
	resolveTrackerSettings: ({ config, env: processEnv }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		return block === undefined
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: processEnv[block['api-key-env']] ?? '' };
	},
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

/** The ticket the plan is added to, which is also the branch its plans implement on. */
const name = 'lo-157-merge-adopt';
const slug = 'search-basics';
/** The id a first plan would take, so a folder that must never appear can be named. */
const planId = '001-search-basics';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** A repository with no tracker at all, so the record stays local and nothing is published. */
const localOnlyConfig: LightsoutConfig = { gates };
/** A repository that CAN reach a tracker, so a fallback to the ticket's attachments would be possible if one existed. */
const trackerConfig: LightsoutConfig = { gates, 'ticket-tracker': { ...ticketTrackerConfigBlock, provider: 'linear' } };
const env = { LINEAR_API_KEY: 'lin_key' };

/** The loose files a folder shaped under a bare slug holds, in the order a listing answers them. */
const looseFiles: Record<string, string> = { 'decisions.json': '{\n\t"decisions": []\n}\n', 'plan.md': '# the plan shaped under a bare slug\n' };

interface RunSeed {
	runId: string;
	/** A `RunStatus` value, as the manifest spells it. */
	status: string;
	/** The plan the run recorded as the one it belongs to, the ticket's own folder by default. */
	planName?: string;
}

interface SetupParams {
	/** Each source folder to plant, by its bare name and the loose files its plans folder holds. */
	sources?: Record<string, Record<string, string>>;
	runs?: RunSeed[];
	/** The run id and pid the checkout's own run lock names. */
	lock?: { runId: string; pid: number };
	config?: LightsoutConfig;
}

/**
 * A temporary checkout belonging to no repository, so its own `.lightsout` is
 * the primary one: the ticket's plans folder, whatever source folders the row
 * plants beside it, the runs the row seeds, and a ticket carrying no
 * attachments of its own.
 */
const setupFromRefusal = ({ sources = {}, runs = [], lock, config = localOnlyConfig }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-add-plan-from-refusals-'));
	const plansFolderOf = ({ folder }: { folder: string }) => join(cwd, '.lightsout', 'tickets', folder, 'plans');

	mkdirSync(plansFolderOf({ folder: name }), { recursive: true });

	for (const [folder, files] of Object.entries(sources)) {
		mkdirSync(plansFolderOf({ folder }), { recursive: true });

		for (const [name, body] of Object.entries(files)) {
			writeFileSync(join(plansFolderOf({ folder }), name), body);
		}
	}

	for (const run of runs) {
		const planName = run.planName ?? name;
		const runDir = runDirFor({ cwd, runId: run.runId, planName });
		const manifest = {
			runId: run.runId,
			createdAt: '2026-01-02T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
			plan: `.lightsout/tickets/${planName}/plans/plan.md`,
			planName,
			pipeline: 'implement',
			harness: 'claude',
			status: run.status,
			currentStep: null,
			steps: [],
			changedFiles: [],
		};

		mkdirSync(runDir, { recursive: true });
		writeFileSync(join(runDir, 'manifest.json'), `${JSON.stringify(manifest, undefined, '\t')}\n`);
	}

	if (lock !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: lock.pid, runId: lock.runId, startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	mockGetTicketAttachments.mockResolvedValue([]);
	// Narrowed to the two fields a publish reads: no row here publishes, and the
	// rest of a tracker's issue shape would say nothing about a refusal.
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-157', identifier: 'LO-157' } as TrackerTicket]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return {
		cwd,
		plansFolderOf,
		recordPath: join(cwd, '.lightsout', 'tickets', name, 'state.json'),
		planFolder: join(plansFolderOf({ folder: name }), planId),
		params: { cwd, name, slug, config, env },
	};
};

/** A folder's sorted entries, or undefined when it was never created. */
const entriesOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

describe('addWorkOrderPlan', () => {
	test("refuses while a live run's plan lies in the source folder and moves nothing", async () => {
		const { params, plansFolderOf, planFolder, recordPath } = setupFromRefusal({
			sources: { [name]: looseFiles },
			runs: [{ runId: 'run-live', status: 'running' }],
			lock: { runId: 'run-live', pid: process.pid },
		});

		const result = await addWorkOrderPlan({ ...params, from: name });

		expect(result).toEqual({ error: expect.stringContaining('run-live') });
		expect({
			source: entriesOf({ dir: plansFolderOf({ folder: name }) }),
			plan: existsSync(planFolder),
			record: existsSync(recordPath),
		}).toStrictEqual({ source: ['decisions.json', 'plan.md'], plan: false, record: false });
	});

	test('refuses a --from value that is a plan address or is not a bare folder name', async () => {
		const { params, plansFolderOf, planFolder, recordPath } = setupFromRefusal({ sources: { [name]: looseFiles } });

		const address = await addWorkOrderPlan({ ...params, from: `${name}/${planId}` });
		const empty = await addWorkOrderPlan({ ...params, from: '' });
		const separated = await addWorkOrderPlan({ ...params, from: 'shaped/under-a-slug' });
		const here = await addWorkOrderPlan({ ...params, from: '.' });
		const above = await addWorkOrderPlan({ ...params, from: '..' });

		// The empty value and the two dot values have no text a sentence could be
		// searched for, so only that each one is refused is pinned; the two values
		// that DO carry text must be named back.
		expect({ address, empty, separated, here, above }).toEqual({
			address: { error: expect.stringContaining(`${name}/${planId}`) },
			empty: { error: expect.any(String) },
			separated: { error: expect.stringContaining('shaped/under-a-slug') },
			here: { error: expect.any(String) },
			above: { error: expect.any(String) },
		});
		expect({
			source: entriesOf({ dir: plansFolderOf({ folder: name }) }),
			plan: existsSync(planFolder),
			record: existsSync(recordPath),
		}).toStrictEqual({ source: ['decisions.json', 'plan.md'], plan: false, record: false });
	});

	test('refuses a --from folder with no loose files and names the folder it looked for', async () => {
		// A tracker IS configured here, so the ticket's attachments are reachable:
		// a fallback to them would show up as an asset read.
		const { params, planFolder, recordPath } = setupFromRefusal({ sources: { 'lo-158-emptied': {} }, config: trackerConfig });

		const absent = await addWorkOrderPlan({ ...params, from: 'lo-158-never-here' });
		const emptied = await addWorkOrderPlan({ ...params, from: 'lo-158-emptied' });

		expect({ absent, emptied }).toEqual({
			absent: { error: expect.stringContaining('lo-158-never-here') },
			emptied: { error: expect.stringContaining('lo-158-emptied') },
		});
		expect(mockReadTicketAsset).not.toHaveBeenCalled();
		expect({ plan: existsSync(planFolder), record: existsSync(recordPath) }).toStrictEqual({ plan: false, record: false });
	});
});
