// Dependencies
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { restoreBrainstormFiles } from '#src/brainstorm/index.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { exportPlanningGeneration } from '#src/plan/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningBrainstormHandoffFixture } from '#tests/helpers/planningBrainstormHandoffFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
const mockAttachments = jest.fn<() => Promise<Array<{ id: string; title: string; url: string }>>>();
const mockRead = jest.fn<(params: { url: string }) => Promise<string>>();
jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: () => mockAttachments(),
	readTicketAsset: (params: { url: string }) => mockRead(params),
}));

const setup = async ({ legacy }: { legacy: boolean }) => {
	const fixture = await planningBrainstormHandoffFixture();
	const cwd = await freshCwd();
	const directory = join(cwd, 'private-plan-staging');
	await mkdir(directory);
	const core = exportPlanningGeneration({ snapshot: fixture.snapshot }).get('planning-record.json');
	if (!core) throw new Error('Expected real portable canonical plan');
	await writeFile(join(directory, 'planning-record.json'), core);
	const assets = new Map<string, string>();
	if (legacy) {
		assets.set('brainstorm-notes.md', 'Unrelated legacy decision');
		assets.set('brainstorm-decisions.json', '{}');
		assets.set(
			'brainstorm-attachments.json',
			serializeAttachmentManifest({ files: [...assets].map(([name, text]) => ({ name, content: Buffer.from(text) })) }).toString(),
		);
	}
	mockAttachments.mockResolvedValue([...assets.keys()].map((title) => ({ id: title, title, url: title })));
	mockRead.mockImplementation(async ({ url }) => assets.get(url) ?? '');
	return { directory, params: { cwd, directory, name: fixture.name, identifier: 'LO-144', settings: trackerSettingsFixture() } };
};

describe('restoreBrainstormFiles', () => {
	test.each([false, true])('refuses a missing or legacy remote handoff for a canonical staged plan (legacy: %s)', async (legacy) => {
		const fixture = await setup({ legacy });

		const report = await restoreBrainstormFiles(fixture.params);

		expect(report.error).toContain('requires its exact canonical brainstorm generation');
		expect(report.restored).toEqual([]);
		await expect(access(join(fixture.directory, 'brainstorm-notes.md'))).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
