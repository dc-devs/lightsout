import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { restoreTicketPlan } from '#src/ticket/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

// Mocked Imports
// -------------------------
// The tracker barrel is the only seam: stubbing it keeps the network out while
// the real plan and brainstorm restores write into a temp checkout, so what this
// restore promises — the plan's own prefixed generation in the plan's own
// folder, and the marker hash in the sidecar — is asserted against real files.
// `resolveTrackerSettings` is re-implemented rather than stubbed away, because
// one of the refusals below is decided from the config it reads.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		return block === undefined || block.provider !== 'linear'
			? { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' }
			: { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey: env[block['api-key-env']] ?? '' };
	},
}));
// -------------------------

const apiKeyEnv = 'LIGHTSOUT_TEST_TRACKER_KEY';
const env: NodeJS.ProcessEnv = { [apiKeyEnv]: 'lin_key' };
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const trackerConfig: LightsoutConfig = { gates, 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': apiKeyEnv } };
/** The same repo with the tracker block taken out, so the restore has nowhere to read from. */
const localOnlyConfig: LightsoutConfig = { gates };
/** A tracker that IS configured and cannot be resolved — never passed over as local only. */
const unusableTrackerConfig: LightsoutConfig = {
	gates,
	'ticket-tracker': { provider: 'jira', 'site-url': 'https://example.atlassian.net', project: 'LO', 'api-key-env': apiKeyEnv, 'api-user-email-env': 'X' },
};

const ticketBranch = 'lo-9-x';
const planId = '002-fix';
const address = `${ticketBranch}/${planId}`;
const planMarkerTitle = `${planId}--plan-attachments.json`;

/** The plan generation the ticket carries under the plan's prefix, by its bare file names. */
const planGeneration: Record<string, string> = { 'plan.md': '# plan 002 of lo-9\n', 'decisions.json': '{\n\t"decisions": []\n}\n' };
/** The brainstorm generation beside it, which owns the notes. */
const brainstormGeneration: Record<string, string> = {
	'brainstorm-notes.md': '# brainstorm notes for 002\n',
	'brainstorm-decisions.json': '{\n\t"decisions": []\n}\n',
};

/** The commit marker for one generation, exactly as publishing writes it. */
const markerOf = ({ files }: { files: Record<string, string> }) =>
	serializeAttachmentManifest({ files: Object.entries(files).map(([name, body]) => ({ name, content: Buffer.from(body, 'utf8') })) }).toString('utf8');

interface SetupParams {
	/** False when the ticket carries no plan generation under this plan's prefix. */
	planGenerationOnTicket?: boolean;
	/** The notes body actually attached, where it differs from the bytes the brainstorm marker commits. */
	attachedNotes?: string;
	/** The plan body actually attached, where it differs from the bytes the plan marker commits. */
	attachedPlan?: string;
	/** Puts a directory where `ticket-sync.json` belongs, so the write recording the restored generation fails. */
	sidecarUnwritable?: boolean;
}

/**
 * A temp checkout belonging to no repository, so its own `.lightsout` folder is
 * the primary one, and a ticket carrying the two prefixed generations beside
 * titles that must never enter them: another plan's, and a bare legacy one.
 */
const setupTicketPlan = ({ planGenerationOnTicket = true, attachedNotes, attachedPlan, sidecarUnwritable }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-restore-ticket-plan-'));
	const bodies: Record<string, string> = { 'plan.md': '# a legacy single-folder plan\n', '001-a--plan.md': '# plan 001 of lo-9\n' };

	if (sidecarUnwritable === true) {
		mkdirSync(join(cwd, '.lightsout', 'plans', ticketBranch, 'ticket-sync.json'), { recursive: true });
	}

	if (planGenerationOnTicket) {
		for (const [name, body] of Object.entries(planGeneration)) {
			bodies[`${planId}--${name}`] = name === 'plan.md' ? (attachedPlan ?? body) : body;
		}

		bodies[planMarkerTitle] = markerOf({ files: planGeneration });
	}

	for (const [name, body] of Object.entries(brainstormGeneration)) {
		bodies[`${planId}--${name}`] = name === 'brainstorm-notes.md' ? (attachedNotes ?? body) : body;
	}

	bodies[`${planId}--brainstorm-attachments.json`] = markerOf({ files: brainstormGeneration });

	const titles = Object.keys(bodies);

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => bodies[titles[Number(url.split('/').at(-1))] ?? ''] ?? '');

	return {
		cwd,
		dir: join(cwd, '.lightsout', 'plans', ticketBranch, planId),
		planMarkerSha256: createHash('sha256')
			.update(bodies[planMarkerTitle] ?? '', 'utf8')
			.digest('hex'),
	};
};

const restore = ({ cwd, name = address, config = trackerConfig }: { cwd: string; name?: string; config?: LightsoutConfig }) => {
	const progress: string[] = [];

	return restoreTicketPlan({ cwd, address: name, config, env, onProgress: (line) => progress.push(line) }).then((result) => ({ result, progress }));
};

/** What the plan's folder holds, or undefined when it was never created. */
const folderOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

/** The per-plan marker hashes the sidecar in the primary checkout's ticket folder records. */
const planMarkersOf = ({ cwd }: { cwd: string }) => {
	try {
		const text = readFileSync(join(cwd, '.lightsout', 'plans', ticketBranch, 'ticket-sync.json'), 'utf8');

		return (JSON.parse(text) as { planMarkers?: Record<string, string> }).planMarkers;
	} catch {
		return undefined;
	}
};

describe('restoreTicketPlan', () => {
	test("restoreTicketPlan: restores the plan and brainstorm generations under the plan's prefix into its folder and records the marker hash", async () => {
		const { cwd, dir, planMarkerSha256 } = setupTicketPlan();

		const { result } = await restore({ cwd });

		expect(result).toStrictEqual({ restored: ['brainstorm-decisions.json', 'brainstorm-notes.md', 'decisions.json', 'plan.md'] });
		expect(folderOf({ dir })).toStrictEqual(['brainstorm-decisions.json', 'brainstorm-notes.md', 'decisions.json', 'plan.md']);
		expect(readFileSync(join(dir, 'plan.md'), 'utf8')).toBe('# plan 002 of lo-9\n');
		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe('# brainstorm notes for 002\n');
		expect(planMarkersOf({ cwd })).toStrictEqual({ '002-fix': planMarkerSha256 });
	});

	test('restoreTicketPlan: answers nothing restored and creates no folder when the ticket carries no generation for this plan', async () => {
		const { cwd, dir } = setupTicketPlan({ planGenerationOnTicket: false });

		const { result } = await restore({ cwd });

		expect(result).toStrictEqual({ restored: [] });
		expect(folderOf({ dir })).toBeUndefined();
		expect(mockGetTicketAttachments).toHaveBeenCalledTimes(1);
	});

	test('restoreTicketPlan: a brainstorm generation that fails verification is reported and does not undo the plan restore', async () => {
		const { cwd, dir } = setupTicketPlan({ attachedNotes: '# notes edited after they were published\n' });

		const { result, progress } = await restore({ cwd });

		expect(result).toStrictEqual({ restored: ['decisions.json', 'plan.md'] });
		expect(folderOf({ dir })).toStrictEqual(['decisions.json', 'plan.md']);
		expect(progress.filter((line) => line.includes('brainstorm-notes.md'))).toStrictEqual([expect.stringContaining('brainstorm-notes.md')]);
	});

	test('restoreTicketPlan: reports a generation it could not record and lets the restored plan stand', async () => {
		const restoredNames = ['brainstorm-decisions.json', 'brainstorm-notes.md', 'decisions.json', 'plan.md'];
		const { cwd, dir } = setupTicketPlan({ sidecarUnwritable: true });

		const { result, progress } = await restore({ cwd });

		// The files are what the caller asked for, and they are on disk: a sidecar
		// this machine could not write is a line to read, not a restore undone.
		expect({ result, folder: folderOf({ dir }), reported: progress.filter((line) => line.includes('could not record')) }).toStrictEqual({
			result: { restored: restoredNames },
			folder: restoredNames,
			reported: [expect.stringContaining(`plan ${planId} was restored`)],
		});
	});

	test('restoreTicketPlan: refuses a name that is not a plan address, and a repository with no ticket-tracker block', async () => {
		const { cwd } = setupTicketPlan();

		const legacyName = await restore({ cwd, name: ticketBranch });
		const noTracker = await restore({ cwd, config: localOnlyConfig });

		// Each refusal has to name its own cause: one sentence for both would let a
		// legacy folder and an unconfigured repository be told apart by nothing.
		expect({ legacyName: legacyName.result, noTracker: noTracker.result }).toStrictEqual({
			legacyName: { error: expect.stringContaining('is not a plan address') },
			noTracker: { error: expect.stringContaining(planId) },
		});
		expect(noTracker.result).toStrictEqual({ error: expect.stringContaining('ticket-tracker') });
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test('restoreTicketPlan: refuses a configured tracker that cannot be resolved rather than answering as if the plan were local only', async () => {
		const { cwd, dir } = setupTicketPlan();

		const { result } = await restore({ cwd, config: unusableTrackerConfig });

		expect(result).toStrictEqual({ error: expect.stringContaining('ticket-tracker') });
		expect(folderOf({ dir })).toBeUndefined();
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test("restoreTicketPlan: answers the plan generation's own refusal, writes no folder and records no marker", async () => {
		const { cwd, dir } = setupTicketPlan({ attachedPlan: '# plan.md edited after it was published\n' });

		const { result } = await restore({ cwd });

		expect(result).toStrictEqual({ error: expect.stringContaining('plan.md') });
		expect(folderOf({ dir })).toBeUndefined();
		expect(planMarkersOf({ cwd })).toBeUndefined();
	});
});
