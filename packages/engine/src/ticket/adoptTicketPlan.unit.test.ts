import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { adoptTicketPlan, updateLocalTicketRecord } from '#src/ticket/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam. The legacy files, the run records, the
// run lock, the moved plan folder and the record itself are real files in a
// temporary checkout, because what adoption promises is which files end up
// where and what the record then says about them.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };
type AttachmentWrite = { ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { identifiers: string[] }) => Promise<{ id: string; identifier: string }[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env: processEnv }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure =>
		config['ticket-tracker'] === undefined
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: processEnv.LINEAR_API_KEY ?? '' },
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

const ticketBranch = 'lo-9-adopt';
const slug = 'search-basics';
const planId = '001-search-basics';
const address = `${ticketBranch}/${planId}`;
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** A repository with no tracker at all, so the record stays local and nothing is published. */
const localOnlyConfig: LightsoutConfig = { gates };
const trackerConfig: LightsoutConfig = { gates, 'ticket-tracker': { ...ticketTrackerConfigBlock, provider: 'linear' } };
const env = { LINEAR_API_KEY: 'lin_key' };

const planBody = '# the single-folder plan of lo-9\n';
const decisionsBody = '{\n\t"decisions": []\n}\n';
const notesBody = '# brainstorm notes of lo-9\n';
const brainstormDecisionsBody = '{\n\t"decisions": []\n}\n';
/** The files a folder shaped before ticket records holds at its top level. */
const legacyPlanFiles: Record<string, string> = { 'plan.md': planBody, 'decisions.json': decisionsBody };
/** Where a run manifest says it built, in the spelling a manifest carries. */
const planPathIn = ({ prefix = '.lightsout/plans', file = 'plan.md' }: { prefix?: string; file?: string } = {}) => `${prefix}/${ticketBranch}/${file}`;

interface RunSeed {
	runId: string;
	/** A `RunStatus` value, as the manifest spells it. */
	status: string;
	/** The repo-relative plan path the run built. */
	plan: string;
	pipeline?: string;
	/** Set on a phase's child run: the coordinator that started it. */
	parentRunId?: string;
	createdAt: string;
}

interface SetupParams {
	/** The files at the ticket folder's top level, by name and body. */
	legacy?: Record<string, string>;
	runs?: RunSeed[];
	/** The run id and pid the checkout's own run lock names. */
	lock?: { runId: string; pid: number };
	/** A ticket record this machine already holds. */
	record?: TicketRecord;
	/** The bare-title attachments the ticket carries, by title and body. */
	attachments?: Record<string, string>;
}

/** The commit marker for one generation, exactly as publishing writes it. */
const markerOf = ({ files }: { files: Record<string, string> }) =>
	serializeAttachmentManifest({ files: Object.entries(files).map(([name, body]) => ({ name, content: Buffer.from(body, 'utf8') })) }).toString('utf8');

/** The bare-title plan and brainstorm generations a ticket shaped before ticket records carries. */
const bareGenerations = (() => {
	const planFiles = { 'plan.md': planBody };
	const brainstormFiles = { 'brainstorm-notes.md': notesBody, 'brainstorm-decisions.json': brainstormDecisionsBody };

	return {
		...planFiles,
		...brainstormFiles,
		'plan-attachments.json': markerOf({ files: planFiles }),
		'brainstorm-attachments.json': markerOf({ files: brainstormFiles }),
	};
})();

/**
 * A temporary checkout belonging to no repository, so its own `.lightsout` is
 * the primary one: a ticket folder holding whatever the row gives it, the run
 * records the row seeds, and a ticket carrying the row's attachments.
 */
const setupAdoption = async ({ legacy = legacyPlanFiles, runs = [], lock, record, attachments = {} }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-adopt-ticket-plan-'));
	const ticketFolder = join(cwd, '.lightsout', 'plans', ticketBranch);

	mkdirSync(ticketFolder, { recursive: true });

	for (const [name, body] of Object.entries(legacy)) {
		writeFileSync(join(ticketFolder, name), body);
	}

	for (const run of runs) {
		const runDir = join(cwd, '.lightsout', 'runs', run.runId);
		const manifest = {
			runId: run.runId,
			createdAt: run.createdAt,
			updatedAt: run.createdAt,
			plan: run.plan,
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

	if (lock !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: lock.pid, runId: lock.runId, startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	if (record !== undefined) {
		await updateLocalTicketRecord({ cwd, ticketBranch, change: () => record });
	}

	const titles = Object.keys(attachments);

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => attachments[titles[Number(url.split('/').at(-1))] ?? ''] ?? '');
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'ticket-1', identifier: 'lo-9' }]);
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return { cwd, ticketFolder, planFolder: join(ticketFolder, planId) };
};

/** Adopt, and hand back the two sides of the answer already told apart. */
const adopt = async ({ cwd, config = localOnlyConfig }: { cwd: string; config?: LightsoutConfig }) => {
	const result = await adoptTicketPlan({ cwd, ticketBranch, slug, config, env });

	return { change: 'error' in result ? undefined : result, error: 'error' in result ? result.error : undefined };
};

/** A directory's sorted entries, or undefined when it was never created. */
const entriesOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

/** What the ticket folder holds besides the ticket's own files — the legacy entries, if any are left. */
const legacyEntriesOf = ({ ticketFolder }: { ticketFolder: string }) => (entriesOf({ dir: ticketFolder }) ?? []).filter((entry) => !entry.startsWith('ticket'));

/** The record's bytes as they are on disk, or undefined when no record was written. */
const recordTextOf = ({ ticketFolder }: { ticketFolder: string }) => {
	try {
		return readFileSync(join(ticketFolder, 'ticket.json'), 'utf8');
	} catch {
		return undefined;
	}
};

const recordOf = ({ ticketFolder }: { ticketFolder: string }) => {
	const text = recordTextOf({ ticketFolder });

	return text === undefined ? undefined : (JSON.parse(text) as TicketRecord);
};

/** The one plan the record holds after an adoption. */
const planEntryOf = ({ ticketFolder }: { ticketFolder: string }) => recordOf({ ticketFolder })?.plans.at(0);

describe('adoptTicketPlan', () => {
	test('moves the legacy files into plan 001 and records it ready to implement when a plan deliverable exists', async () => {
		const { cwd, ticketFolder, planFolder } = await setupAdoption();

		const { change } = await adopt({ cwd });

		expect(change).toEqual(expect.objectContaining({ address }));
		expect({ topLevel: legacyEntriesOf({ ticketFolder }), moved: entriesOf({ dir: planFolder }) }).toStrictEqual({
			topLevel: [planId],
			moved: ['decisions.json', 'plan.md'],
		});
		expect(readFileSync(join(planFolder, 'plan.md'), 'utf8')).toBe(planBody);
		expect(planEntryOf({ ticketFolder })).toEqual(expect.objectContaining({ id: planId, progress: 'ready' }));
		expect(recordOf({ ticketFolder })?.history.map(({ kind }) => kind)).toStrictEqual(['plan-adopted']);
	});

	test('records plan 001 as planning when the legacy folder holds no plan deliverable', async () => {
		const { cwd, ticketFolder, planFolder } = await setupAdoption({ legacy: { 'brainstorm-notes.md': notesBody } });

		const { change } = await adopt({ cwd });

		expect(change).toEqual(expect.objectContaining({ address }));
		expect(entriesOf({ dir: planFolder })).toStrictEqual(['brainstorm-notes.md']);
		expect(planEntryOf({ ticketFolder })).toEqual(expect.objectContaining({ id: planId, progress: 'planning' }));
	});

	test('records plan 001 as implemented when a passed top-level implement or phases run built the folder', async () => {
		const { cwd, ticketFolder } = await setupAdoption({
			runs: [{ runId: 'run-passed', status: 'passed', plan: planPathIn(), createdAt: '2026-01-02T00:00:00.000Z' }],
		});

		const { change } = await adopt({ cwd });

		expect(change).toEqual(expect.objectContaining({ address }));
		expect(planEntryOf({ ticketFolder })).toEqual(expect.objectContaining({ id: planId, progress: 'implemented' }));
	});

	test("does not count a passed child run of a phased coordinator as the folder's implementation", async () => {
		const { cwd, ticketFolder } = await setupAdoption({
			legacy: { 'overview.md': '# the overview of lo-9\n', 'phase1-a.md': '# phase 1\n' },
			runs: [
				{ runId: 'run-coordinator', status: 'failed', pipeline: 'phases', plan: planPathIn({ file: 'overview.md' }), createdAt: '2026-01-02T00:00:00.000Z' },
				{
					runId: 'run-child',
					status: 'passed',
					parentRunId: 'run-coordinator',
					plan: planPathIn({ file: 'phase1-a.md' }),
					createdAt: '2026-01-03T00:00:00.000Z',
				},
			],
		});

		const { change } = await adopt({ cwd });

		expect(change).toEqual(expect.objectContaining({ address }));
		expect(planEntryOf({ ticketFolder })).toEqual(expect.objectContaining({ id: planId, progress: 'ready' }));
	});

	test("refuses while a live run's plan lies in the folder and moves nothing", async () => {
		const { cwd, ticketFolder, planFolder } = await setupAdoption({
			runs: [{ runId: 'run-live', status: 'running', plan: planPathIn(), createdAt: '2026-01-02T00:00:00.000Z' }],
			lock: { runId: 'run-live', pid: process.pid },
		});

		const { change, error } = await adopt({ cwd });

		expect(error).toEqual(expect.stringContaining('run-live'));
		expect({
			change,
			topLevel: legacyEntriesOf({ ticketFolder }),
			moved: entriesOf({ dir: planFolder }),
			record: recordTextOf({ ticketFolder }),
		}).toStrictEqual({
			change: undefined,
			topLevel: ['decisions.json', 'plan.md'],
			moved: undefined,
			record: undefined,
		});
	});

	test('adopts past a run that is no longer live and records how far its implementation got', async () => {
		const escalated = await setupAdoption({
			runs: [{ runId: 'run-escalated', status: 'escalated', plan: planPathIn(), createdAt: '2026-01-02T00:00:00.000Z' }],
		});
		const paused = await setupAdoption({
			runs: [{ runId: 'run-paused', status: 'paused-rate-limit', plan: planPathIn(), createdAt: '2026-01-02T00:00:00.000Z' }],
		});
		// A `running` manifest with no lock behind it: the leftover of a process
		// that died, which says the implementation started and never finished.
		const stale = await setupAdoption({ runs: [{ runId: 'run-stale', status: 'running', plan: planPathIn(), createdAt: '2026-01-02T00:00:00.000Z' }] });

		const afterEscalated = await adopt({ cwd: escalated.cwd });
		const afterPaused = await adopt({ cwd: paused.cwd });
		const afterStale = await adopt({ cwd: stale.cwd });

		expect({
			escalated: planEntryOf({ ticketFolder: escalated.ticketFolder })?.progress,
			paused: planEntryOf({ ticketFolder: paused.ticketFolder })?.progress,
			stale: planEntryOf({ ticketFolder: stale.ticketFolder })?.progress,
		}).toStrictEqual({ escalated: 'failed', paused: 'implementing', stale: 'implementing' });
		expect({ escalated: afterEscalated.error, paused: afterPaused.error, stale: afterStale.error }).toStrictEqual({
			escalated: undefined,
			paused: undefined,
			stale: undefined,
		});
		expect(afterEscalated.change?.notice).toEqual(expect.stringContaining('lightsout implement --plan'));
		expect(afterEscalated.change?.notice).toEqual(expect.stringContaining(planId));
	});

	test('refuses a ticket that already has a record and leaves the legacy files in place', async () => {
		const existing: TicketRecord = {
			schemaVersion: 1,
			ticketRef: 'lo-9',
			branch: ticketBranch,
			mode: 'multiple-plan',
			plans: [{ id: '001-earlier', title: 'Earlier', progress: 'ready', createdAt: '2026-01-01T00:00:00.000Z' }],
			history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-earlier' }],
		};
		const { cwd, ticketFolder, planFolder } = await setupAdoption({ record: existing });
		const before = recordTextOf({ ticketFolder });

		const { change, error } = await adopt({ cwd });

		expect(error).toEqual(expect.any(String));
		expect({
			change,
			topLevel: legacyEntriesOf({ ticketFolder }),
			moved: entriesOf({ dir: planFolder }),
			record: recordTextOf({ ticketFolder }),
		}).toStrictEqual({
			change: undefined,
			topLevel: ['decisions.json', 'plan.md'],
			moved: undefined,
			record: before,
		});
	});

	test('refuses a folder with no legacy files to adopt', async () => {
		const { cwd, ticketFolder, planFolder } = await setupAdoption({ legacy: {}, attachments: {} });

		const { change, error } = await adopt({ cwd, config: trackerConfig });

		expect(error).toEqual(expect.any(String));
		expect({ change, moved: entriesOf({ dir: planFolder }), record: recordTextOf({ ticketFolder }) }).toStrictEqual({
			change: undefined,
			moved: undefined,
			record: undefined,
		});
	});

	test("restores the ticket's bare-title generations first when the primary checkout holds no legacy folder", async () => {
		const { cwd, ticketFolder, planFolder } = await setupAdoption({ legacy: {}, attachments: bareGenerations });

		const { change, error } = await adopt({ cwd, config: trackerConfig });

		expect({ error, address: change?.address }).toStrictEqual({ error: undefined, address });
		expect({ topLevel: legacyEntriesOf({ ticketFolder }), moved: entriesOf({ dir: planFolder }) }).toStrictEqual({
			topLevel: [planId],
			moved: ['brainstorm-decisions.json', 'brainstorm-notes.md', 'plan.md'],
		});
		expect(planEntryOf({ ticketFolder })).toEqual(expect.objectContaining({ id: planId, progress: 'ready' }));
	});

	test("counts a passed run under the historical plans prefix as the folder's implementation", async () => {
		const { cwd, ticketFolder } = await setupAdoption({
			runs: [{ runId: 'run-historical', status: 'passed', plan: planPathIn({ prefix: '.claude/plans' }), createdAt: '2026-01-02T00:00:00.000Z' }],
		});

		const { change } = await adopt({ cwd });

		expect(change).toEqual(expect.objectContaining({ address }));
		expect(planEntryOf({ ticketFolder })).toEqual(expect.objectContaining({ id: planId, progress: 'implemented' }));
	});

	test('puts back every file it had already moved when one of the moves fails', async () => {
		const { cwd, ticketFolder, planFolder } = await setupAdoption();
		// A directory standing where `plan.md` has to land, so the second move
		// fails after the first has already gone through. The entries move in
		// sorted order, which puts `decisions.json` in plan 001's folder first.
		mkdirSync(join(planFolder, 'plan.md'), { recursive: true });
		writeFileSync(join(planFolder, 'plan.md', 'not-ours.txt'), 'a human put this here\n');

		const { change, error } = await adopt({ cwd });

		expect(error).toEqual(expect.any(String));
		expect({
			change,
			plan: readFileSync(join(ticketFolder, 'plan.md'), 'utf8'),
			decisions: readFileSync(join(ticketFolder, 'decisions.json'), 'utf8'),
			record: recordTextOf({ ticketFolder }),
		}).toStrictEqual({ change: undefined, plan: planBody, decisions: decisionsBody, record: undefined });
		// The undo never deletes: what was in the way is the human's, not this
		// command's to remove.
		expect(readFileSync(join(planFolder, 'plan.md', 'not-ours.txt'), 'utf8')).toBe('a human put this here\n');
	});

	test('returns a notice naming plan publish for the adopted plan address', async () => {
		const { cwd } = await setupAdoption();

		const { change } = await adopt({ cwd });

		expect(change?.notice).toEqual(expect.stringContaining(`lightsout plan publish --name ${address}`));
	});
});
