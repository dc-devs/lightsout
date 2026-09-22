import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanProgress, WorkOrderEventKind, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import type { TrackerAttachment, TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { addWorkOrderPlan, updateLocalWorkOrderState } from '#src/workOrder/index.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam. The loose files, the run manifests, the
// moved plan folder and the record itself are real files in a temporary
// checkout, because what `--from` promises is which files end up where and what
// the record then says about them.
/** What `setTicketAttachment` takes, named so the mock and its wrapper each read on one line. */
type AttachmentWrite = { settings: TrackerSettings; ticketId: string; title: string; content: Buffer; contentType: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<TrackerAttachment[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();
const mockSetTicketAttachment = jest.fn<(params: AttachmentWrite) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env: processEnv }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure =>
		config['ticket-tracker'] === undefined
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: processEnv.LINEAR_API_KEY ?? '' },
	setTicketAttachment: (params: AttachmentWrite) => mockSetTicketAttachment(params),
}));
// -------------------------

/** The ticket the plan is added to, whose name carries the ticket id every record below names. */
const name = 'lo-9-merge';
/** A plan folder shaped under a bare slug, which is what `--from` names when it is not the ticket's own branch. */
const sourceBranch = 'search-notes';
const slug = 'search-basics';
const planId = '001-search-basics';
const address = 'lo-9-merge/001-search-basics';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** A repository with no tracker at all, so the record stays local and nothing is published. */
const localOnlyConfig: LightsoutConfig = { gates };
const env = { LINEAR_API_KEY: 'lin_key' };

const planBody = '# the plan shaped under a bare slug\n';
const notesBody = '# the brainstorm notes shaped under a bare slug\n';
const humanFileBody = 'a human put this here\n';
/** The loose files a plans folder holds when nobody has made a plan out of them yet. */
const loosePlanFiles: Record<string, string> = { 'brainstorm-notes.md': notesBody, 'plan.md': planBody };
/** A decisions record naming the folder it was written in, with a field no schema knows about. */
const decisionsBody = '{\n\t"planName": "search-notes",\n\t"decisions": [],\n\t"notes": "kept by the rewrite"\n}\n';
const brainstormBody = '{\n\t"planName": "search-notes",\n\t"decisions": [],\n\t"askedBy": "brainstorm"\n}\n';
/** The day every seeded run is dated. */
const runDay = '2026-01-02T00:00:00.000Z';

interface RunSeed {
	runId: string;
	/** A `RunStatus` value, as the manifest spells it. */
	status: string;
	/** The plan the run recorded as the one it belongs to. */
	planName: string;
}

/** One run of the source folder, in the byte shape a manifest carries. */
const manifestBody = ({ runId, status, planName }: RunSeed) =>
	`${JSON.stringify(
		{
			runId,
			createdAt: runDay,
			updatedAt: runDay,
			plan: `.lightsout/work-orders/${planName}/plans/plan.md`,
			planName,
			pipeline: 'implement',
			harness: 'claude',
			status,
			currentStep: null,
			steps: [],
			changedFiles: [],
		},
		undefined,
		'\t',
	)}\n`;

/** A record this machine already holds, in the mode that lets a ticket carry more than one plan. */
const existingRecord = ({ planIds }: { planIds: string[] }): WorkOrderState => ({
	schemaVersion: 1,
	ticketRef: 'lo-9',
	branch: name,
	mode: WorkOrderMode.MultiplePlan,
	plans: planIds.map((id) => ({ id, title: id.slice(4), progress: PlanProgress.Ready, createdAt: '2026-01-01T00:00:00.000Z' })),
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: `plan ${planIds.at(-1) ?? ''} was added` }],
});

interface SetupParams {
	/** The folder `--from` names, which is the ticket's own branch unless a row says otherwise. */
	source?: string;
	/** The loose files that folder's plans folder holds, by name and body. */
	files?: Record<string, string>;
	/** A work order state this machine already holds. */
	record?: WorkOrderState;
	/** Runs recorded against the source folder. */
	runs?: RunSeed[];
	/** Plan folders the ticket's own plans folder already holds, each given a `plan.md`. */
	planFolders?: string[];
	/** Folders planted beside the source's `plans/`, which retiring may never take away. */
	sourceSiblings?: string[];
}

/**
 * A temporary checkout belonging to no repository, so its own `.lightsout` is
 * the primary one: the ticket's plans folder, the source folder's plans folder
 * holding whatever the row gives it, and the runs the row seeds.
 */
const setupFrom = async ({ source = name, files = loosePlanFiles, record, runs = [], planFolders = [], sourceSiblings = [] }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-add-plan-from-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);
	const sourceFolder = join(cwd, '.lightsout', 'work-orders', source);
	const sourcePlans = join(sourceFolder, 'plans');

	mkdirSync(join(workOrderFolder, 'plans'), { recursive: true });
	mkdirSync(sourcePlans, { recursive: true });

	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(sourcePlans, name), body);
	}

	for (const name of planFolders) {
		mkdirSync(join(workOrderFolder, 'plans', name), { recursive: true });
		writeFileSync(join(workOrderFolder, 'plans', name, 'plan.md'), `# ${name}\n`);
	}

	for (const name of sourceSiblings) {
		mkdirSync(join(sourceFolder, name, 'left-behind'), { recursive: true });
	}

	for (const run of runs) {
		const runDir = runDirFor({ cwd, runId: run.runId, planName: run.planName });

		mkdirSync(runDir, { recursive: true });
		writeFileSync(join(runDir, 'manifest.json'), manifestBody(run));
	}

	if (record !== undefined) {
		await updateLocalWorkOrderState({ cwd, name, change: () => record });
	}

	mockGetTicketAttachments.mockResolvedValue([]);
	mockGetTicketsByIdentifiers.mockResolvedValue([{ id: 'id-9', identifier: 'LO-9' } as TrackerTicket]);
	mockReadTicketAsset.mockResolvedValue({ error: 'no asset' });
	mockSetTicketAttachment.mockResolvedValue(undefined);

	return { cwd, workOrderFolder, plansFolder: join(workOrderFolder, 'plans'), sourceFolder, sourcePlans };
};

/** Add the plan, and hand back the two sides of the answer already told apart. */
const addPlan = async ({ cwd, from, title }: { cwd: string; from?: string; title?: string }) => {
	const result = await addWorkOrderPlan({ cwd, name, slug, title, from, config: localOnlyConfig, env });

	return { change: 'error' in result ? undefined : result, error: 'error' in result ? result.error : undefined };
};

/** A directory's sorted entries, or undefined when it is not there at all. */
const entriesOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

/** The record as it stands on disk, which is what a later command reads. */
const recordAt = ({ workOrderFolder }: { workOrderFolder: string }) => {
	try {
		return JSON.parse(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')) as WorkOrderState;
	} catch {
		return undefined;
	}
};

/** A moved JSON record, read as the plain object it is so its fields and its key order can both be read. */
const jsonAt = ({ path }: { path: string }) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

describe('addWorkOrderPlan', () => {
	test("moves the named folder's loose files into the new plan and leaves nothing loose beside it", async () => {
		const { cwd, workOrderFolder, plansFolder } = await setupFrom();
		const planFolder = join(plansFolder, planId);

		const { change, error } = await addPlan({ cwd, from: name });

		expect({ error, address: change?.address }).toStrictEqual({ error: undefined, address });
		expect({ loose: entriesOf({ dir: plansFolder }), moved: entriesOf({ dir: planFolder }) }).toStrictEqual({
			loose: [planId],
			moved: ['brainstorm-notes.md', 'plan.md'],
		});
		expect(readFileSync(join(planFolder, 'plan.md'), 'utf8')).toBe(planBody);
		expect(recordAt({ workOrderFolder })?.plans).toEqual([expect.objectContaining({ id: planId })]);
	});

	test("allocates the next plan id for a source folder that is not the ticket's own branch", async () => {
		const { cwd, plansFolder, sourcePlans } = await setupFrom({
			source: sourceBranch,
			record: existingRecord({ planIds: ['001-alpha', '002-beta'] }),
			planFolders: ['001-alpha', '002-beta'],
		});

		const { change, error } = await addPlan({ cwd, from: sourceBranch });

		expect({ error, address: change?.address }).toStrictEqual({ error: undefined, address: 'lo-9-merge/003-search-basics' });
		expect({
			added: entriesOf({ dir: join(plansFolder, '003-search-basics') }),
			first: entriesOf({ dir: join(plansFolder, '001-alpha') }),
			second: entriesOf({ dir: join(plansFolder, '002-beta') }),
			source: entriesOf({ dir: sourcePlans }),
		}).toStrictEqual({ added: ['brainstorm-notes.md', 'plan.md'], first: ['plan.md'], second: ['plan.md'], source: undefined });
	});

	test('takes away the emptied source folder and leaves one that still holds something', async () => {
		const emptied = await setupFrom({ source: sourceBranch });
		// A `runs/` folder beside the source's `plans/`: a non-recursive removal
		// takes away only what is provably empty, so this work order folder stands.
		const kept = await setupFrom({ source: sourceBranch, sourceSiblings: ['runs'] });

		const afterEmptied = await addPlan({ cwd: emptied.cwd, from: sourceBranch });
		const afterKept = await addPlan({ cwd: kept.cwd, from: sourceBranch });

		expect({ emptied: afterEmptied.error, kept: afterKept.error }).toStrictEqual({ emptied: undefined, kept: undefined });
		expect({
			emptiedFolder: existsSync(emptied.sourceFolder),
			keptFolder: entriesOf({ dir: kept.sourceFolder }),
			keptPlans: existsSync(kept.sourcePlans),
		}).toStrictEqual({ emptiedFolder: false, keptFolder: ['runs'], keptPlans: false });
	});

	test("never retires the source when it is the ticket's own folder", async () => {
		const { cwd, workOrderFolder, plansFolder } = await setupFrom();

		const { error } = await addPlan({ cwd, from: name });

		expect({ error, workOrderFolder: existsSync(workOrderFolder), plans: entriesOf({ dir: plansFolder }) }).toStrictEqual({
			error: undefined,
			workOrderFolder: true,
			plans: [planId],
		});
	});

	test('puts back every file it had already moved when one of the moves fails and says where the files are', async () => {
		const { cwd, workOrderFolder, plansFolder, sourcePlans } = await setupFrom({
			source: sourceBranch,
			files: { 'decisions.json': decisionsBody, 'plan.md': planBody },
		});
		// A directory standing where `plan.md` has to land, so the second move
		// fails after the first has already gone through: the entries move in
		// sorted order, which puts `decisions.json` in the plan's folder first.
		const planFolder = join(plansFolder, planId);

		mkdirSync(join(planFolder, 'plan.md'), { recursive: true });
		writeFileSync(join(planFolder, 'plan.md', 'not-ours.txt'), humanFileBody);

		const { change, error } = await addPlan({ cwd, from: sourceBranch });

		expect({ error, address: change?.address }).toStrictEqual({ error: undefined, address });
		expect(change?.notice).toEqual(expect.stringContaining(sourcePlans));
		expect(change?.notice).toEqual(expect.stringContaining(planFolder));
		expect({
			plan: readFileSync(join(sourcePlans, 'plan.md'), 'utf8'),
			decisions: readFileSync(join(sourcePlans, 'decisions.json'), 'utf8'),
			planned: recordAt({ workOrderFolder })?.plans.map((plan) => plan.id),
			// The put-back never deletes: what was in the way is the human's.
			human: readFileSync(join(planFolder, 'plan.md', 'not-ours.txt'), 'utf8'),
		}).toStrictEqual({ plan: planBody, decisions: decisionsBody, planned: [planId], human: humanFileBody });
	});

	test("rewrites planName in both moved records to the plan's address and leaves their other fields alone", async () => {
		const carried = await setupFrom({
			source: sourceBranch,
			files: { 'brainstorm-decisions.json': brainstormBody, 'decisions.json': decisionsBody, 'plan.md': planBody },
		});
		const bare = await setupFrom({ source: sourceBranch, files: { 'plan.md': planBody } });

		const afterCarried = await addPlan({ cwd: carried.cwd, from: sourceBranch });
		const afterBare = await addPlan({ cwd: bare.cwd, from: sourceBranch });

		const decisions = jsonAt({ path: join(carried.plansFolder, planId, 'decisions.json') });
		const brainstorm = jsonAt({ path: join(carried.plansFolder, planId, 'brainstorm-decisions.json') });

		expect({ error: afterCarried.error, decisions, brainstorm }).toStrictEqual({
			error: undefined,
			decisions: { planName: address, decisions: [], notes: 'kept by the rewrite' },
			brainstorm: { planName: address, decisions: [], askedBy: 'brainstorm' },
		});
		expect({ decisionKeys: Object.keys(decisions), brainstormKeys: Object.keys(brainstorm) }).toStrictEqual({
			decisionKeys: ['planName', 'decisions', 'notes'],
			brainstormKeys: ['planName', 'decisions', 'askedBy'],
		});
		// A folder holding neither record has nothing to report about one.
		expect(afterBare.change?.notice ?? '').toEqual(expect.not.stringContaining('decisions.json'));
	});

	test('reports an unrewritable record in the notice and lets the plan stand', async () => {
		const { cwd, workOrderFolder, plansFolder } = await setupFrom({
			source: sourceBranch,
			files: { 'decisions.json': '{ this was never JSON', 'plan.md': planBody },
		});

		const { change, error } = await addPlan({ cwd, from: sourceBranch });

		expect({ error, address: change?.address }).toStrictEqual({ error: undefined, address });
		expect(change?.notice).toEqual(expect.stringContaining('decisions.json'));
		expect({
			planned: recordAt({ workOrderFolder })?.plans.map((plan) => plan.id),
			moved: entriesOf({ dir: join(plansFolder, planId) }),
		}).toStrictEqual({ planned: [planId], moved: ['decisions.json', 'plan.md'] });
	});

	test('joins the publish and resume sentences into the one notice', async () => {
		const { cwd } = await setupFrom({
			source: sourceBranch,
			files: { 'plan.md': planBody },
			runs: [{ runId: 'run-escalated', status: 'escalated', planName: sourceBranch }],
		});

		const { change, error } = await addPlan({ cwd, from: sourceBranch });

		expect(error).toBeUndefined();
		expect(change?.notice).toEqual(expect.stringContaining('lightsout plan publish --name lo-9-merge/001-search-basics'));
		expect(change?.notice).toEqual(expect.stringContaining('lightsout implement --plan .lightsout/work-orders/lo-9-merge/plans/001-search-basics'));
	});

	test('records plan-adopted for the --from form and plan-added without it', async () => {
		const fromSource = await setupFrom({ source: sourceBranch });
		const empty = await setupFrom({ files: {} });

		const afterFrom = await addPlan({ cwd: fromSource.cwd, from: sourceBranch });
		const afterPlain = await addPlan({ cwd: empty.cwd });

		expect({ from: afterFrom.error, plain: afterPlain.error }).toStrictEqual({ from: undefined, plain: undefined });
		expect({
			from: recordAt({ workOrderFolder: fromSource.workOrderFolder })?.history.map(({ kind }) => kind),
			plain: recordAt({ workOrderFolder: empty.workOrderFolder })?.history.map(({ kind }) => kind),
		}).toStrictEqual({ from: ['plan-adopted'], plain: ['plan-added'] });
	});

	test('takes --title with --from exactly as it does without it', async () => {
		const titled = await setupFrom({ source: sourceBranch });
		const untitled = await setupFrom({ source: sourceBranch });

		const afterTitled = await addPlan({ cwd: titled.cwd, from: sourceBranch, title: 'Search basics, from the brainstorm' });
		const afterUntitled = await addPlan({ cwd: untitled.cwd, from: sourceBranch });

		expect({ titled: afterTitled.error, untitled: afterUntitled.error }).toStrictEqual({ titled: undefined, untitled: undefined });
		expect({
			titled: recordAt({ workOrderFolder: titled.workOrderFolder })?.plans.at(0)?.title,
			untitled: recordAt({ workOrderFolder: untitled.workOrderFolder })?.plans.at(0)?.title,
		}).toStrictEqual({ titled: 'Search basics, from the brainstorm', untitled: 'search-basics' });
	});
});
