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
});
