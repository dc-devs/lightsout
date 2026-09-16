import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { restoreBrainstormFiles } from '#src/brainstorm/restore/restoreBrainstormFiles.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
}));
// -------------------------

const settings = trackerSettingsFixture();
const name = 'lo-117-brainstorm-outcome';

/** The bytes every attachment carries unless a test asks for its own. */
const defaultBody = ({ title }: { title: string }) => `body of ${title}\n`;

interface SetupParams {
	/** Attachment titles the ticket carries, apart from the brainstorm commit marker. */
	attachments: string[];
	/** Bodies by attachment title; anything unlisted gets `defaultBody`. */
	bodies?: Record<string, string>;
	/** File names the marker commits. Defaults to both brainstorm file names. */
	manifestFiles?: string[];
	/** Exact marker body, for the hash-mismatch case. */
	manifestText?: string;
	/** How many `brainstorm-attachments.json` attachments the ticket carries. */
	manifestCopies?: number;
	/** Files already in the plan folder before the restore runs. */
	onDisk?: Record<string, string>;
}

/**
 * Build a ticket generation and, when a test asks for it, a plan folder that
 * already holds files — the case the brainstorm fetch is written for, because
 * planning authors `facts.json` there before this ever runs.
 */
const setup = ({ attachments, bodies = {}, manifestFiles, manifestText, manifestCopies = 1, onDisk = {} }: SetupParams) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-restore-brainstorm-'));
	const dir = join(cwd, '.lightsout', 'plans', name);

	if (Object.keys(onDisk).length > 0) {
		mkdirSync(dir, { recursive: true });

		for (const [file, text] of Object.entries(onDisk)) {
			writeFileSync(join(dir, file), text, 'utf8');
		}
	}

	const bodyOf = (title: string) => bodies[title] ?? defaultBody({ title });
	const listed = manifestFiles ?? ['brainstorm-notes.md', 'brainstorm-decisions.json'];
	const marker =
		manifestText ?? serializeAttachmentManifest({ files: listed.map((file) => ({ name: file, content: Buffer.from(bodyOf(file), 'utf8') })) }).toString('utf8');
	const titles = [...attachments, ...Array.from({ length: manifestCopies }, () => 'brainstorm-attachments.json')];
	const assetBodies = titles.map((title, index) => (index >= attachments.length ? marker : bodyOf(title)));

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => assetBodies[Number(url.split('/').at(-1))] ?? '');

	return { cwd, dir };
};

const restore = ({ cwd }: { cwd: string }) => restoreBrainstormFiles({ cwd, name, identifier: 'lo-117', settings });

/** What the plan folder holds, or undefined when it was never created. */
const folderOf = ({ dir }: { dir: string }) => {
	try {
		return readdirSync(dir).sort();
	} catch {
		return undefined;
	}
};

interface PrefixedSetupParams {
	/** Every attachment title the ticket carries, apart from the commit markers below. */
	attachments: string[];
	/** Commit markers to build, keyed by their full attachment title, each listing the bare file names it commits. */
	markers?: Record<string, string[]>;
	/** The plan the files are written into — a plan address for a plan inside a ticket folder. */
	planName?: string;
}

/** The plan id a prefixed attachment title carries, or undefined for a bare title. */
const prefixOf = ({ title }: { title: string }) => (title.includes('--') ? title.slice(0, title.indexOf('--')) : undefined);

/**
 * Build a ticket carrying several plans' brainstorm generations side by side,
 * each under its own plan id prefix, plus the bare-title generation a ticket
 * shaped before ticket records carries.
 *
 * A marker commits bare file names while the attachment itself wears the
 * marker's own prefix, so a generation can only ever verify against the files
 * published under the same plan id.
 */
const setupPrefixed = ({ attachments, markers = {}, planName = name }: PrefixedSetupParams) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-restore-brainstorm-prefixed-'));
	const dir = join(cwd, '.lightsout', 'plans', planName);

	const markerBodies: Record<string, string> = {};

	for (const [markerTitle, listed] of Object.entries(markers)) {
		const prefix = prefixOf({ title: markerTitle });

		markerBodies[markerTitle] = serializeAttachmentManifest({
			files: listed.map((file) => ({
				name: file,
				content: Buffer.from(defaultBody({ title: prefix === undefined ? file : `${prefix}--${file}` }), 'utf8'),
			})),
		}).toString('utf8');
	}

	const titles = [...attachments, ...Object.keys(markers)];

	mockGetTicketAttachments.mockResolvedValue(titles.map((title, index) => ({ id: `att-${index}`, title, url: `https://assets.example/${index}` })));
	mockReadTicketAsset.mockImplementation(async ({ url }) => {
		const title = titles[Number(url.split('/').at(-1))] ?? '';

		return markerBodies[title] ?? defaultBody({ title });
	});

	return { cwd, dir, planName };
};

const restorePrefixed = ({ cwd, planName, titlePrefix }: { cwd: string; planName: string; titlePrefix?: string }) =>
	restoreBrainstormFiles({ cwd, name: planName, identifier: 'lo-117', settings, titlePrefix });

describe('restoreBrainstormFiles', () => {
	test('restoreBrainstormFiles: writes both files into a folder that already holds facts.json', async () => {
		const { cwd, dir } = setup({
			attachments: ['brainstorm-notes.md', 'brainstorm-decisions.json'],
			onDisk: { 'facts.json': '{"facts":[]}\n' },
		});

		const restored = await restore({ cwd });

		expect(restored).toStrictEqual({ restored: ['brainstorm-decisions.json', 'brainstorm-notes.md'], skipped: [] });
		expect(folderOf({ dir })).toStrictEqual(['brainstorm-decisions.json', 'brainstorm-notes.md', 'facts.json']);
		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe('body of brainstorm-notes.md\n');
		expect(readFileSync(join(dir, 'facts.json'), 'utf8')).toBe('{"facts":[]}\n');
	});

	test('restoreBrainstormFiles: keeps a brainstorm-notes.md already on disk and reports it skipped', async () => {
		const { cwd, dir } = setup({
			attachments: ['brainstorm-notes.md', 'brainstorm-decisions.json'],
			onDisk: { 'brainstorm-notes.md': 'the local write-up\n' },
		});

		const restored = await restore({ cwd });

		expect(restored).toStrictEqual({ restored: ['brainstorm-decisions.json'], skipped: ['brainstorm-notes.md'] });
		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe('the local write-up\n');
		expect(readFileSync(join(dir, 'brainstorm-decisions.json'), 'utf8')).toBe('body of brainstorm-decisions.json\n');
	});

	test('restoreBrainstormFiles: refuses when brainstorm-notes.md does not match its committed SHA-256', async () => {
		const { cwd, dir } = setup({
			attachments: ['brainstorm-notes.md', 'brainstorm-decisions.json'],
			manifestText: JSON.stringify({
				schemaVersion: 1,
				files: [
					{ name: 'brainstorm-notes.md', sha256: '0'.repeat(64) },
					{ name: 'brainstorm-decisions.json', sha256: sha256({ content: defaultBody({ title: 'brainstorm-decisions.json' }) }) },
				],
			}),
		});

		const restored = await restore({ cwd });

		expect(restored.restored).toStrictEqual([]);
		expect(restored.skipped).toStrictEqual([]);
		expect(restored.error).toEqual(expect.stringContaining('brainstorm-notes.md'));
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('restoreBrainstormFiles: refuses a generation that carries only brainstorm-notes.md', async () => {
		const { cwd, dir } = setup({
			attachments: ['brainstorm-notes.md'],
			manifestFiles: ['brainstorm-notes.md'],
		});

		const restored = await restore({ cwd });

		expect(restored.restored).toStrictEqual([]);
		expect(restored.skipped).toStrictEqual([]);
		expect(restored.error).toEqual(expect.stringContaining('brainstorm-decisions.json'));
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('restoreBrainstormFiles: answers with nothing when the ticket carries no brainstorm attachment', async () => {
		const { cwd, dir } = setup({ attachments: ['facts.json', 'draft-stream.jsonl'], manifestCopies: 0 });

		const restored = await restore({ cwd });

		expect(restored).toStrictEqual({ restored: [], skipped: [] });
		expect(folderOf({ dir })).toBeUndefined();
		expect(mockReadTicketAsset).not.toHaveBeenCalled();
	});

	test('restoreBrainstormFiles: ignores plan-attachments.json and the plan deliverable on the same ticket', async () => {
		const { cwd, dir } = setup({
			attachments: ['plan.md', 'grade.json', 'plan-attachments.json', 'brainstorm-notes.md', 'brainstorm-decisions.json'],
		});

		const restored = await restore({ cwd });

		expect(restored).toStrictEqual({ restored: ['brainstorm-decisions.json', 'brainstorm-notes.md'], skipped: [] });
		expect(folderOf({ dir })).toStrictEqual(['brainstorm-decisions.json', 'brainstorm-notes.md']);
	});

	test('restoreBrainstormFiles: answers with nothing when the ticket carries a published plan and no brainstorm generation', async () => {
		const { cwd, dir } = setup({
			attachments: ['plan.md', 'brainstorm-notes.md', 'grade.json', 'plan-attachments.json'],
			manifestCopies: 0,
		});

		const restored = await restore({ cwd });

		expect(restored).toStrictEqual({ restored: [], skipped: [] });
		expect(folderOf({ dir })).toBeUndefined();
	});

	test("restoreBrainstormFiles: with a title prefix, restores a notes-only generation under that prefix and ignores other plans' and bare brainstorm titles", async () => {
		const { cwd, dir, planName } = setupPrefixed({
			planName: `${name}/001-x`,
			attachments: [
				'001-x--brainstorm-notes.md',
				'002-y--brainstorm-notes.md',
				'002-y--brainstorm-decisions.json',
				'brainstorm-notes.md',
				'brainstorm-decisions.json',
			],
			markers: {
				'001-x--brainstorm-attachments.json': ['brainstorm-notes.md'],
				'002-y--brainstorm-attachments.json': ['brainstorm-notes.md', 'brainstorm-decisions.json'],
				'brainstorm-attachments.json': ['brainstorm-notes.md', 'brainstorm-decisions.json'],
			},
		});

		const restored = await restorePrefixed({ cwd, planName, titlePrefix: '001-x' });

		expect(restored).toStrictEqual({ restored: ['brainstorm-notes.md'], skipped: [] });
		expect(folderOf({ dir })).toStrictEqual(['brainstorm-notes.md']);
		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe('body of 001-x--brainstorm-notes.md\n');
	});

	test('restoreBrainstormFiles: with a title prefix, refuses prefixed brainstorm-notes.md with no prefixed marker', async () => {
		const { cwd, dir, planName } = setupPrefixed({
			planName: `${name}/001-x`,
			attachments: ['001-x--brainstorm-notes.md'],
			markers: { 'brainstorm-attachments.json': ['brainstorm-notes.md', 'brainstorm-decisions.json'] },
		});

		const restored = await restorePrefixed({ cwd, planName, titlePrefix: '001-x' });

		expect(restored.restored).toStrictEqual([]);
		expect(restored.skipped).toStrictEqual([]);
		expect(restored.error).toEqual(expect.stringContaining('001-x--brainstorm-attachments.json'));
		expect(folderOf({ dir })).toBeUndefined();
	});

	test('restoreBrainstormFiles: without a title prefix, ignores prefixed brainstorm titles', async () => {
		const { cwd, dir, planName } = setupPrefixed({
			attachments: ['001-x--brainstorm-notes.md', '001-x--brainstorm-decisions.json'],
			markers: { '001-x--brainstorm-attachments.json': ['brainstorm-notes.md', 'brainstorm-decisions.json'] },
		});

		const restored = await restorePrefixed({ cwd, planName });

		expect(restored).toStrictEqual({ restored: [], skipped: [] });
		expect(folderOf({ dir })).toBeUndefined();
		expect(mockReadTicketAsset).not.toHaveBeenCalled();
	});
});

test.each(['missing-asset', 'duplicate-asset', 'asset-unavailable', 'marker-unavailable', 'invalid-marker'])(
	'refuses an unreadable or ambiguous brainstorm generation: %s',
	async (defect) => {
		const attachments = defect === 'missing-asset' ? ['brainstorm-notes.md'] : ['brainstorm-notes.md', 'brainstorm-decisions.json'];
		if (defect === 'duplicate-asset') attachments.push('brainstorm-notes.md');
		const fixture = setup({ attachments, ...(defect === 'invalid-marker' ? { manifestText: '{}' } : {}) });
		if (defect === 'asset-unavailable')
			mockReadTicketAsset.mockImplementation(async ({ url }) =>
				url.endsWith('/2')
					? serializeAttachmentManifest({
							files: ['brainstorm-notes.md', 'brainstorm-decisions.json'].map((title) => ({ name: title, content: Buffer.from(defaultBody({ title })) })),
						}).toString()
					: { error: 'Asset unavailable' },
			);
		if (defect === 'marker-unavailable') mockReadTicketAsset.mockResolvedValue({ error: 'Marker unavailable' });
		const result = await restore(fixture);
		expect(result.error).toMatch(/no attachment|more than one attachment|Asset unavailable|Marker unavailable|schemaVersion/);
		expect(result.restored).toStrictEqual([]);
		expect(folderOf(fixture)).toBeUndefined();
	},
);

test('refuses canonical brainstorm content with no generation binding', async () => {
	const fixture = setup({
		attachments: ['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-record.json'],
		manifestFiles: ['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-record.json'],
	});
	const result = await restore(fixture);
	expect(result.error).toBe('New-format brainstorm requires an explicit generation marker');
	expect(result.restored).toStrictEqual([]);
});

test('returns canonical validation failures without exposing partially restored files', async () => {
	const files = ['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-record.json'];
	const marker = serializeAttachmentManifest({
		files: files.map((title) => ({ name: title, content: Buffer.from(defaultBody({ title })) })),
		brainstormGeneration: 'a'.repeat(64),
	}).toString();
	const fixture = setup({ attachments: files, manifestFiles: files, manifestText: marker });
	const result = await restore(fixture);
	expect(result.error).toBeDefined();
	expect(result.restored).toStrictEqual([]);
	expect(folderOf(fixture)).toBeUndefined();
});
