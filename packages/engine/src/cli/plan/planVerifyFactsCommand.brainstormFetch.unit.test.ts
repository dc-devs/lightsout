import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planVerifyFactsCommand } from '#src/cli/plan/planVerifyFactsCommand.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Mocked Imports
// -------------------------
// The tracker is the only seam: it is the one thing that would leave the
// machine. The real `ensureBrainstormFiles` and the real `restoreBrainstormFiles`
// run against a real linked worktree, which is the whole point of this file —
// the folder they write into has to be the primary checkout's, not the tree's.
// `resolveTrackerSettings` is re-implemented rather than stubbed away, because
// the silent pass-over on a repo with no tracker block is its own refusal.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { settings: TrackerSettings; identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { settings: TrackerSettings; url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketAttachments: (params: { settings: TrackerSettings; identifier: string }) => mockGetTicketAttachments(params),
	readTicketAsset: (params: { settings: TrackerSettings; url: string }) => mockReadTicketAsset(params),
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		// Only the linear block is ever planted here, so anything else is the
		// "no tracker to ask" case the fetch passes over in silence.
		if (block === undefined || block.provider !== 'linear') {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		return { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey: env[block['api-key-env']] ?? '' };
	},
}));
// -------------------------

/** A plan name carrying ticket lo-150, which is the key the brainstorm fetch turns on. */
const ticketPlanName = 'lo-150-planning-observability';
const branch = 'lo-150-planning-observability';
const notesBody = '# the brainstorm write-up\n';
const decisionsBody = '{"planName":"lo-150-planning-observability","decisions":[]}\n';
const gates = { check: 'true', test: 'true', 'test-coverage': false };

/** Facts a deterministic verify-facts run can check without an agent: one real path, one real script. */
const authoredFacts = {
	request: 'move the plan folder to the primary checkout',
	areas: [
		{
			area: 'cli',
			affectedPackages: [],
			filesToModify: [{ path: 'src/real.ts', role: 'the file that exists' }],
			patternsToMirror: [],
			integrationPoints: [],
			scripts: [{ key: 'check', command: 'tsc --noEmit' }],
			namingConvention: 'camelCase',
		},
	],
};

/** One published brainstorm generation on the ticket, under the bare titles a legacy plan folder carries. */
const publishAttachments = ({ failure }: { failure?: TrackerFailure }) => {
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

	mockGetTicketAttachments.mockResolvedValue(
		failure ?? [
			{ id: 'att-1', title: 'brainstorm-notes.md', url: 'https://assets.example/brainstorm-notes.md' },
			{ id: 'att-2', title: 'brainstorm-decisions.json', url: 'https://assets.example/brainstorm-decisions.json' },
			{ id: 'att-3', title: 'brainstorm-attachments.json', url: 'https://assets.example/brainstorm-attachments.json' },
		],
	);
	mockReadTicketAsset.mockImplementation(async ({ url }) => bodies[url] ?? { error: `no asset at ${url}` });
};

/**
 * A primary checkout with a linked worktree added from it, the plan's authored
 * facts already in the primary checkout's plan folder, and one brainstorm
 * generation waiting on the ticket.
 *
 * The command is handed the worktree as its `cwd`, which is where a plan
 * command runs once `plan.worktree` moves the session into a tree. The verified
 * paths and scripts are committed, so the tree carries them too and the
 * verification itself is unaffected by which checkout it runs in.
 */
const setupVerifyFactsFromWorktree = ({
	name = ticketPlanName,
	config = { gates, 'ticket-tracker': ticketTrackerConfigBlock },
	failure,
	ticketRef = 'lo-150',
}: {
	/** The plan's `--name`, and the folder its facts are authored in. */
	name?: string;
	/** The config the repo carries; `null` writes no `lightsout.config.json` at all. */
	config?: Record<string, unknown> | null;
	/** What the tracker answers instead of an attachment list, when the ticket cannot be asked at all. */
	failure?: TrackerFailure;
	/** The ticket the plan's work order belongs to, as its record carries it. `null` names a work order that belongs to none. */
	ticketRef?: string | null;
} = {}) => {
	const captured = captureCommandOutput();
	const { cwd } = setupBranchRepo();
	const git = (command: string) => execSync(command, { cwd, stdio: 'ignore' });

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc --noEmit' } }));
	writeFileSync(join(cwd, 'src', 'real.ts'), 'export const real = true;\n');

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	git('git add -A');
	git('git commit -qm "the consumer repo"');

	const primary = realpathSync(cwd);
	const worktree = join(cwd, '.worktrees', branch);

	git(`git worktree add -q -b ${branch} "${worktree}" main`);

	const planDir = planWorkspaceFolder({ cwd: primary, name: name });

	// Which ticket a brainstorm is fetched from is the work order record's answer.
	seedWorkOrderRecord({ cwd: primary, name: workOrderNameOf({ name }), ticketRef: ticketRef ?? undefined });
	mkdirSync(planDir, { recursive: true });
	writeFileSync(join(planDir, 'facts.json'), JSON.stringify(authoredFacts));
	publishAttachments({ failure });

	return { context: { flags: parseFlags({ args: ['--name', name] }), rest: [], cwd: worktree }, primary, worktree, planDir, ...captured };
};

describe('planVerifyFactsCommand', () => {
	test("fetches the ticket's brainstorm into the primary checkout's plan folder when the session runs in a linked worktree", async () => {
		const { context, worktree, planDir, logged, errors, exitCodes } = setupVerifyFactsFromWorktree();

		await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

		expect(readFileSync(join(planDir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(readFileSync(join(planDir, 'brainstorm-decisions.json'), 'utf8')).toBe(decisionsBody);
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
		expect(logged[0]).toBe(`lightsout: fetched 2 brainstorm file(s) from ticket lo-150 into ${planDir}`);
		expect(logged.at(-1)).toBe(`\nfacts: ${join(planDir, 'facts.json')}`);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('reports a brainstorm the ticket could not supply and verifies the facts anyway', async () => {
		const { context, planDir, logged, errors, exitCodes } = setupVerifyFactsFromWorktree({ failure: { error: 'no ticket lo-150 in team LO' } });

		await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe('lightsout: could not fetch the brainstorm from ticket lo-150: no ticket lo-150 in team LO');
		expect(existsSync(join(planDir, 'brainstorm-notes.md'))).toBe(false);
		expect(logged.at(-1)).toBe(`\nfacts: ${join(planDir, 'facts.json')}`);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('fetches from the ticket the record names, even when the plan’s label spells no ticket id at all', async () => {
		const { context, planDir, logged, exitCodes } = setupVerifyFactsFromWorktree({ name: 'rate-limit-banner', ticketRef: 'ENG-4821' });

		await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

		// Nothing reads a ticket id out of a label any more, so a label that spells
		// none still reaches the ticket its work order's record belongs to.
		expect(mockGetTicketAttachments).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'ENG-4821' }));
		expect(readFileSync(join(planDir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(logged[0]).toBe(`lightsout: fetched 2 brainstorm file(s) from ticket ENG-4821 into ${planDir}`);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('asks no ticket and prints no fetch line for a work order whose record carries no ticket reference', async () => {
		const { context, planDir, logged, exitCodes } = setupVerifyFactsFromWorktree({ name: 'rate-limit-banner', ticketRef: null });

		await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(logged.at(-1)).toBe(`\nfacts: ${join(planDir, 'facts.json')}`);
		expect(exitCodes).toStrictEqual([0]);
	});

	test.each([
		{ scenario: 'no lightsout.config.json at all', config: null },
		{ scenario: 'a config carrying no ticket-tracker block', config: { gates } },
	])('asks no ticket and still verifies the facts in a repo with $scenario', async ({ config }) => {
		const { context, planDir, logged, exitCodes } = setupVerifyFactsFromWorktree({ config });

		await expect(planVerifyFactsCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(logged.at(-1)).toBe(`\nfacts: ${join(planDir, 'facts.json')}`);
		expect(exitCodes).toStrictEqual([0]);
	});
});
