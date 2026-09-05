import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { brainstormPublishCommand } from '#src/cli/brainstorm/brainstormPublishCommand.ts';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The action is another module's entry point: the only behaviour this file owns
// is what reaches it, what is printed, and how the command ends. The subject is
// imported from its own file rather than the folder's barrel — the test sits
// inside the module, and the barrel would load every sibling subcommand against
// a brainstorm module that is mocked down to one export.
interface BrainstormPublishReport {
	ticketRef?: string;
	published: string[];
	error?: string;
}

interface PublishParams {
	cwd: string;
	name: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
}

const mockPublishBrainstorm = jest.fn<(params: PublishParams) => Promise<BrainstormPublishReport>>();

jest.mock('#src/brainstorm/index.ts', () => ({ publishBrainstorm: (params: PublishParams) => mockPublishBrainstorm(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

const setupPublish = ({
	args,
	report = { ticketRef: 'LO-117', published: ['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-attachments.json'] },
}: {
	args: string[];
	/** What the action answers: both brainstorm files plus their commit marker, by default. */
	report?: BrainstormPublishReport;
}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-brainstorm-publish-command-'));

	mockPublishBrainstorm.mockResolvedValue(report);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('brainstormPublishCommand', () => {
	test('brainstormPublishCommand: prints the ticket and each attached file, then exits 0', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupPublish({ args: ['--name', 'lo-117-brainstorm-outcome'] });

		await expect(brainstormPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// the repo's own config reaches the action, tracker block and all — without
		// it the action can resolve no tracker to attach to
		expect(mockPublishBrainstorm.mock.calls[0]?.[0]).toMatchObject({
			cwd,
			name: 'lo-117-brainstorm-outcome',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
			onProgress: expect.any(Function),
		});
		// the process environment is handed over rather than read inside the action,
		// which is what keeps the API key out of a second reader
		expect(mockPublishBrainstorm.mock.calls[0]?.[0]?.env).toBe(process.env);
		expect(logged[0]).toBe('\nbrainstorm publish lo-117-brainstorm-outcome — 3 file(s) attached to LO-117');
		expect(logged.slice(1, 4)).toStrictEqual(['  brainstorm-notes.md', '  brainstorm-decisions.json', '  brainstorm-attachments.json']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('brainstormPublishCommand: prints the refusal to stderr and exits 1', async () => {
		const { context, logged, errors, exitCodes } = setupPublish({
			args: ['--name', 'demo'],
			report: { published: [], error: "nothing to publish for 'demo': brainstorm-decisions.json not found — run the brainstorm skill first" },
		});

		await expect(brainstormPublishCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors[0]).toBe("\nnothing to publish for 'demo': brainstorm-decisions.json not found — run the brainstorm skill first");
		expect(exitCodes).toStrictEqual([1]);
	});
});
