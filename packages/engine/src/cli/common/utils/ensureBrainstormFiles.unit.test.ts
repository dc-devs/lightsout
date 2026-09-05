import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ensureBrainstormFiles } from '#src/cli/common/utils/ensureBrainstormFiles.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

// Mocked Imports
// -------------------------
// The tracker module is the seam: mocking its barrel keeps the network out
// while the real `restoreBrainstormFiles` writes into the temp repo, so what
// this fetch promises — the two files on disk and one line naming the ticket
// and the folder — is asserted against real files. `resolveTrackerSettings` is
// re-implemented rather than stubbed away, because the silent return on a repo
// with no tracker block is its own refusal.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		// Only the linear block is ever planted here, so anything else is the
		// "no tracker to ask" case this helper passes over in silence.
		if (block === undefined || block.provider !== 'linear') {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		return { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey: env[block['api-key-env']] ?? '' };
	},
}));
// -------------------------

const name = 'lo-117-brainstorm-decides-its-outcome';
const notesBody = '# the brainstorm write-up\n';
const decisionsBody = '{"planName":"lo-117-brainstorm-decides-its-outcome","decisions":[]}\n';

/** A repo carrying the tracker block, with one published brainstorm waiting on the ticket. */
const seedCwd = async ({ config = { 'ticket-tracker': ticketTrackerConfigBlock } }: { config?: Record<string, unknown> } = {}) => {
	const marker = serializeAttachmentManifest({
		files: [
			{ name: 'brainstorm-notes.md', content: Buffer.from(notesBody, 'utf8') },
			{ name: 'brainstorm-decisions.json', content: Buffer.from(decisionsBody, 'utf8') },
		],
	}).toString('utf8');
	const bodies: Record<string, string> = {
		'https://assets.example/brainstorm-notes.md': notesBody,
		'https://assets.example/brainstorm-decisions.json': decisionsBody,
		'https://assets.example/brainstorm-attachments.json': marker,
	};

	mockGetTicketAttachments.mockResolvedValue([
		{ id: 'att-1', title: 'brainstorm-notes.md', url: 'https://assets.example/brainstorm-notes.md' },
		{ id: 'att-2', title: 'brainstorm-decisions.json', url: 'https://assets.example/brainstorm-decisions.json' },
		{ id: 'att-3', title: 'brainstorm-attachments.json', url: 'https://assets.example/brainstorm-attachments.json' },
	]);
	mockReadTicketAsset.mockImplementation(async ({ url }) => bodies[url] ?? { error: `no asset at ${url}` });

	return seedConfiguredCwd({ config });
};

const ensure = ({ cwd }: { cwd: string }) => {
	const printed: string[] = [];

	return ensureBrainstormFiles({ cwd, name, write: (line) => printed.push(line) }).then(() => printed);
};

describe('ensureBrainstormFiles', () => {
	test('ensureBrainstormFiles: fetches both files and prints one line naming the ticket and the folder', async () => {
		const cwd = await seedCwd();
		const dir = join(cwd, '.lightsout', 'plans', name);

		const printed = await ensure({ cwd });

		expect(readFileSync(join(dir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(readFileSync(join(dir, 'brainstorm-decisions.json'), 'utf8')).toBe(decisionsBody);
		expect(printed).toStrictEqual([`lightsout: fetched 2 brainstorm file(s) from ticket lo-117 into ${dir}`]);
	});

	test('ensureBrainstormFiles: prints nothing and returns when the repo has no lightsout.config.json', async () => {
		const cwd = await freshCwd();

		const printed = await ensure({ cwd });

		expect(printed).toStrictEqual([]);
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
	});

	test('ensureBrainstormFiles: prints one warning and returns when the restore reports an error', async () => {
		const cwd = await seedCwd();

		mockGetTicketAttachments.mockResolvedValue({ error: 'no ticket lo-117 in team LO' });

		const printed = await ensure({ cwd });

		expect(printed).toStrictEqual(['lightsout: could not fetch the brainstorm from ticket lo-117: no ticket lo-117 in team LO']);
	});
});
