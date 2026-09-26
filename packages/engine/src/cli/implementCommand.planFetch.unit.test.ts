import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { planAttachmentManifestName } from '#src/plan/common/constants/planAttachmentManifestName.ts';
import { isDurablePlanAttachmentName } from '#src/plan/common/utils/isDurablePlanAttachmentName.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The tracker module is the only seam mocked here: the real gate, the real
// restore and the real plan resolution all run against a temp repo, so what the
// command promises — disk first, then the ticket, then one sentence naming both
// — is asserted against files that actually landed. `resolveTrackerSettings` is
// re-implemented rather than stubbed away, because one refusal below is its own.
type TrackerFailure = { error: string };
type Attachment = { id: string; title: string; url: string };

const mockGetTicketAttachments = jest.fn<(params: { identifier: string }) => Promise<Attachment[] | TrackerFailure>>();
const mockReadTicketAsset = jest.fn<(params: { url: string }) => Promise<string | TrackerFailure>>();

jest.mock('#src/ticketTracker/getTicketAttachments.ts', () => ({
	getTicketAttachments: (params: { identifier: string }) => mockGetTicketAttachments(params),
}));
jest.mock('#src/ticketTracker/readTicketAsset.ts', () => ({ readTicketAsset: (params: { url: string }) => mockReadTicketAsset(params) }));
jest.mock('#src/ticketTracker/resolveTrackerSettings.ts', () => ({
	resolveTrackerSettings: ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }): TrackerSettings | TrackerFailure => {
		const block = config['ticket-tracker'];

		if (block === undefined) {
			return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
		}

		const apiKey = env[block['api-key-env']] ?? '';

		return block.provider === 'linear'
			? { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey }
			: {
					provider: 'jira',
					ticketPrefix: block.project,
					siteUrl: block['site-url'].replace(/\/$/u, ''),
					project: block.project,
					apiKey,
					apiUserEmail: env[block['api-user-email-env']] ?? '',
				};
	},
}));
// -------------------------

/** The work order every case here points `--plan` inside — named after ticket lo-54, which is the key the fetch turns on. */
const workOrderName = 'lo-54-portable-plan';
/** The plan's own id, and the namespace every attachment of it is titled under. */
const planId = '001-portable-plan';
const name = `${workOrderName}/${planId}`;
const planPath = join('.lightsout', 'work-orders', workOrderName, 'plans', planId);

/** An overview whose Phases table names one phase file, so a restored phased plan is one a run can actually start. */
const overviewBody = '# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n| 1 | `phase1-setup.md` | scope |\n';

/**
 * A real consumer repo whose plan folder is absent, so the command has to reach
 * the ticket for it. The run lock is planted by default: a restored plan is a
 * plan the pipeline starts on, and the lock is what stops it one step in — which
 * is how "the fetch happened, and the run then used what it fetched" becomes
 * observable without spawning an agent.
 */
const setupFetch = ({
	args = ['--plan', planPath],
	titles = ['plan.md'],
	bodies = {},
	failure,
	config = { 'ticket-tracker': ticketTrackerConfigBlock },
	onDisk,
	locked = true,
	workOrder = { name: workOrderName, ticketRef: 'lo-54' },
}: {
	args?: string[];
	/** Attachment titles the ticket carries. */
	titles?: string[];
	/** Asset text by title, for the cases where the restored content has to parse. */
	bodies?: Record<string, string>;
	/** What the tracker answers instead of a list, when the ticket cannot be asked at all. */
	failure?: TrackerFailure;
	/** Extra top-level config fields, replacing the tracker block a fetch needs. */
	config?: Record<string, unknown>;
	/** Plan files to plant in the folder before the command runs, which is what makes disk win. */
	onDisk?: Record<string, string>;
	locked?: boolean;
	/** The work order whose record the fetch reads the ticket out of, and the reference it carries. */
	workOrder?: { name: string; ticketRef?: string };
} = {}) => {
	const bodyOf = (title: string) => bodies[title] ?? `# Plan: restored ${title}\n`;
	const durable = [...new Set(titles.filter((title) => isDurablePlanAttachmentName({ name: title })))];
	const manifest = serializeAttachmentManifest({ files: durable.map((title) => ({ name: title, content: Buffer.from(bodyOf(title), 'utf8') })) }).toString(
		'utf8',
	);
	const attachmentTitles = durable.length === 0 ? titles : [...titles, planAttachmentManifestName];

	// A ticket carries every plan's files side by side, so each title is written
	// under this plan's own namespace — which is what the addressed restore reads.
	mockGetTicketAttachments.mockResolvedValue(
		failure ??
			attachmentTitles.map((title, index) => ({
				id: `att-${index}`,
				title: `${planId}--${title}`,
				url: `https://assets.example/${planId}--${title}`,
			})),
	);
	mockReadTicketAsset.mockImplementation(({ url }) => {
		const title = (url.split('/').at(-1) ?? '').replace(`${planId}--`, '');

		return Promise.resolve(title === planAttachmentManifestName ? manifest : bodyOf(title));
	});

	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config });

	// Which ticket a plan is fetched from is its work order record's answer, so
	// the record stands on disk before the command runs.
	seedWorkOrderRecord({
		cwd,
		name: workOrder.name,
		ticketRef: workOrder.ticketRef,
		plans: [{ id: planId, title: 'Portable plan', progress: 'ready', createdAt: '2026-01-01T00:00:00.000Z' }],
	});

	if (onDisk !== undefined) {
		mkdirSync(join(cwd, planPath), { recursive: true });

		for (const [file, body] of Object.entries(onDisk)) {
			writeFileSync(join(cwd, planPath, file), body);
		}
	}

	if (locked) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { context: { flags: parseFlags({ args: [...args, '--no-worktree'] }), rest: [], cwd }, cwd, ...captured };
};

describe('implementCommand', () => {
	test('a plan folder already on disk is the one that runs — the ticket is never asked', async () => {
		const { context, cwd, logged, exitCodes } = setupFetch({ onDisk: { 'plan.md': '# Plan: the copy on this machine\n' } });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[1]).toBe(`  plan: ${join(planPath, 'plan.md')}`);
		expect(readFileSync(join(cwd, planPath, 'plan.md'), 'utf8')).toBe('# Plan: the copy on this machine\n');
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a --plan outside the repo plans directory is nobody’s plan workspace, and the ticket is never asked', async () => {
		// no run lock here: this case has to reach the pipeline's own missing-file
		// error, which is what proves the gate let the path through untouched
		const { context, logged, errors, exitCodes } = setupFetch({ args: ['--plan', 'ghost.md'], locked: false });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[1]).toBe('  plan: ghost.md');
		expect(errors.some((line) => /plan file not found: .*ghost\.md/.test(line))).toBeTruthy();
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a missing plan folder is rebuilt from its ticket, and the run says so before it starts', async () => {
		const { context, cwd, logged, exitCodes } = setupFetch();

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		const output = logged.join('\n');

		// the fetch line is printed before the run header, because the fetch has to
		// have happened before anything asks the disk what shape the plan is
		expect(output).toContain(`lightsout: fetched 1 plan file(s) from ticket lo-54 into ${join(cwd, planPath)}`);
		expect(output).toContain('lightsout: starting run');
		expect(output).toContain(`  plan: ${join(planPath, 'plan.md')}`);
		expect(output.indexOf('fetched 1 plan file')).toBeLessThan(output.indexOf('lightsout: starting run'));
		expect(readFileSync(join(cwd, planPath, 'plan.md'), 'utf8')).toBe('# Plan: restored plan.md\n');
		expect(mockGetTicketAttachments).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'lo-54' }));
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a phased plan comes back whole — every phase file beside its overview, and the banner names the overview', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupFetch({
			titles: ['overview.md', 'phase1-setup.md'],
			bodies: { 'overview.md': overviewBody },
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.join('\n')).toContain(`lightsout: fetched 2 plan file(s) from ticket lo-54 into ${join(cwd, planPath)}`);
		expect(readFileSync(join(cwd, planPath, 'overview.md'), 'utf8')).toBe(overviewBody);
		expect(readFileSync(join(cwd, planPath, 'phase1-setup.md'), 'utf8')).toBe('# Plan: restored phase1-setup.md\n');
		expect(logged.join('\n')).toContain(`  overview: ${join(planPath, 'overview.md')}`);
		// the planted lock stops the first phase's own run, which means the phase
		// loop was entered against the restored overview
		expect(errors.join('\n')).toContain('another lightsout run is active in this repo');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a ticket carrying no plan attachment stops the run with one sentence naming the only place it looked', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupFetch({ titles: [] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		// the ticket carries nothing under this plan's namespace, so the sentence
		// names the folder it looked in and the command that puts the plan there
		expect(errors).toHaveLength(1);
		expect(errors[0] ?? '').toContain(`no plan at ${join(cwd, planPath)}`);
		expect(errors[0] ?? '').toContain('lo-54');
		expect(errors[0] ?? '').toContain(`lightsout plan publish --name ${name}`);
		expect(existsSync(join(cwd, planPath))).toBe(false);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a tracker failure stops the run, naming the missing folder, ticket and concrete restore reason', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupFetch({ failure: { error: "no ticket 'lo-54' in team LO" } });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		// the work order's own record is settled before the plan is asked for, so a
		// tracker that cannot be read stops there — naming the folder, the work
		// order and the tracker's own words
		expect(errors).toHaveLength(1);
		expect(errors[0] ?? '').toContain(`no plan at ${join(cwd, planPath)}`);
		expect(errors[0] ?? '').toContain(workOrderName);
		expect(errors[0] ?? '').toContain("no ticket 'lo-54' in team LO");
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a ticket whose attachments are not a runnable plan leaves no folder behind, so a later publish is still fetchable', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupFetch({ titles: ['overview.md'] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors.join('\n')).toContain(`no plan at ${join(cwd, planPath)}`);
		expect(errors.join('\n')).toContain('could not be restored:');
		expect(errors.join('\n')).toContain('expected plan.md on its own, or overview.md with at least one phase<N> file');
		expect(existsSync(join(cwd, planPath))).toBe(false);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a repo naming no ticket tracker has nowhere to fetch from, and the refusal names the missing folder and the missing block', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupFetch({ config: {} });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([
			`no plan at ${join(cwd, planPath)}, and no plan could be fetched from the ticket: this command needs a \`ticket-tracker\` block in lightsout.config.json naming a provider and its credentials`,
		]);
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a work order whose record carries no ticket reference has no ticket to ask, and the refusal names it', async () => {
		const path = join('.lightsout', 'work-orders', 'portable-plan', 'plans', planId);
		const { context, cwd, logged, errors, exitCodes } = setupFetch({ args: ['--plan', path], workOrder: { name: 'portable-plan' } });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([
			`no plan at ${join(cwd, path)}, and no plan could be fetched from a ticket: work order 'portable-plan' carries no ticket reference in its record, so it belongs to no ticket`,
		]);
		expect(mockGetTicketAttachments).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('an unusable ship.ticket-pattern reaches the fetch not at all, because the record answers which ticket this is', async () => {
		const { context, cwd, logged, exitCodes } = setupFetch({
			config: { 'ticket-tracker': ticketTrackerConfigBlock, ship: { 'ticket-pattern': '(' } },
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		// The plan came back from the ticket the record names, so the run stopped on
		// its own run lock rather than on a pattern that decides nothing here.
		expect(logged.join('\n')).toContain(`lightsout: fetched 1 plan file(s) from ticket lo-54 into ${join(cwd, planPath)}`);
		expect(exitCodes).toStrictEqual([1]);
	});
});
