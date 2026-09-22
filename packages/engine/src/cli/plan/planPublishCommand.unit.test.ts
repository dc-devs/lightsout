import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { activityRecordPath, buildActivityTree, readActivityMarks } from '#src/activity/index.ts';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planPublishCommand } from '#src/cli/plan/planPublishCommand.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planAttachmentManifestName } from '#src/plan/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The action is another module's entry point: the only behaviour this file owns
// is what reaches it, what is printed, and how the command ends. Only the action
// is replaced — the plan module's other exports stay real, so the planning
// record the command writes around it lands on disk for real. The subject is
// imported from its own file rather than the folder's barrel, because the test
// sits inside the module.
interface PublishReport {
	ticketRef?: string;
	published: string[];
	stale: string[];
	error?: string;
}

interface PublishParams {
	cwd: string;
	name: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
	/** The plan id every attachment title is namespaced under — never set for a legacy folder. */
	titlePrefix?: string;
}

const mockPublishPlan = jest.fn<(params: PublishParams) => Promise<PublishReport>>();

jest.mock('#src/plan/index.ts', () => ({
	...jest.requireActual<typeof import('#src/plan/index.ts')>('#src/plan/index.ts'),
	publishPlan: (params: PublishParams) => mockPublishPlan(params),
}));
// -------------------------
// The ticket-record publish is the same kind of boundary: another module's
// entry point, replaced so this file asserts only which of the two publishers a
// name reaches, what is printed about it, and how the command ends.
interface TicketPublishReport {
	ticketRef?: string;
	published: string[];
	stale: string[];
	error?: string;
	/** Why state.json does not record a publish whose plan files did land. */
	recordError?: string;
}

interface TicketPublishParams {
	cwd: string;
	address: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
}

const mockPublishTicketPlan = jest.fn<(params: TicketPublishParams) => Promise<TicketPublishReport>>();

jest.mock('#src/workOrder/index.ts', () => ({
	...jest.requireActual<typeof import('#src/workOrder/index.ts')>('#src/workOrder/index.ts'),
	publishWorkOrderPlan: (params: TicketPublishParams) => mockPublishTicketPlan(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

const setupPublish = ({
	args,
	withConfig = true,
	report = { ticketRef: 'LO-54', published: ['plan.md', 'decisions.json', planAttachmentManifestName], stale: [] },
}: {
	args: string[];
	withConfig?: boolean;
	/** What the action answers: two durable files plus their commit marker, by default. */
	report?: PublishReport;
}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-publish-command-'));

	mockPublishPlan.mockResolvedValue(report);

	if (withConfig) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/** A publish of `demo` whose plan folder exists, so the planning record has somewhere to land. */
const setupPublishWithPlanFolder = ({ report, withConfig }: { report?: PublishReport; withConfig?: boolean } = {}) => {
	const published = setupPublish({ args: ['--name', 'demo'], report, withConfig });
	const planDir = join(published.cwd, '.lightsout', 'tickets', 'demo', 'plans');

	mkdirSync(planDir, { recursive: true });

	return { ...published, planDir };
};

/** A publish of the plan address `lo-9-x/001-a`, whose plan folder exists, so the planning record has somewhere to land. */
const setupTicketPublish = ({
	report = {
		ticketRef: 'LO-9',
		published: ['001-a--plan.md', '001-a--decisions.json', `001-a--${planAttachmentManifestName}`, 'state.json'],
		stale: [],
	},
}: {
	/** What the ticket-record publish answers: the plan's prefixed files, its marker and the record, by default. */
	report?: TicketPublishReport;
} = {}) => {
	const published = setupPublish({ args: ['--name', 'lo-9-x/001-a'] });
	const planDir = join(published.cwd, '.lightsout', 'tickets', 'lo-9-x', 'plans', '001-a');

	mkdirSync(planDir, { recursive: true });
	mockPublishTicketPlan.mockResolvedValue(report);

	return { ...published, planDir };
};

describe('planPublishCommand', () => {
	test('prints the ticket and every attached file, and exits 0', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupPublish({ args: ['--name', 'lo-54-portable-plan'] });

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// the repo's own config reaches the action, tracker block and all — without
		// it the action can resolve no tracker to attach to
		expect(mockPublishPlan.mock.calls[0]?.[0]).toMatchObject({
			cwd,
			name: 'lo-54-portable-plan',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
			onProgress: expect.any(Function),
		});
		// the process environment is handed over rather than read inside the action,
		// which is what keeps the API key out of a second reader
		expect(mockPublishPlan.mock.calls[0]?.[0]?.env).toBe(process.env);
		expect(logged[0]).toBe('\nplan publish lo-54-portable-plan — 3 file(s) attached to LO-54');
		expect(logged.slice(1, 4)).toStrictEqual(['  plan.md', '  decisions.json', `  ${planAttachmentManifestName}`]);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('names a stale attachment after the published list and still exits 0, because the publish succeeded', async () => {
		const { context, logged, exitCodes } = setupPublish({
			args: ['--name', 'lo-54-portable-plan'],
			report: { ticketRef: 'LO-54', published: ['overview.md', planAttachmentManifestName], stale: ['plan.md'] },
		});

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.at(-1) ?? '').toMatch(/^\nstill on LO-54 from an earlier publish, and not written by this run: plan\.md/);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('prints the report’s own sentence on stderr and exits 1 when the publish stopped', async () => {
		const { context, logged, errors, exitCodes } = setupPublish({
			args: ['--name', 'demo'],
			report: { published: [], stale: [], error: "nothing to publish for 'demo': no plan found" },
		});

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors[0]).toBe("\nnothing to publish for 'demo': no plan found");
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a repo carrying no lightsout.config.json is refused by name, and nothing is published', async () => {
		const { context } = setupPublish({ args: ['--name', 'lo-54-portable-plan'], withConfig: false });

		await expect(planPublishCommand(context)).rejects.toThrow(/lightsout\.config\.json not found/);

		// publishing needs a ticket-tracker block, so a repo with no config has
		// nothing to resolve and never reaches the tracker
		expect(mockPublishPlan).not.toHaveBeenCalled();
	});

	test('without --name it prints the usage text on stderr and exits 1, before reading any config', async () => {
		const { context, errors, exitCodes } = setupPublish({ args: [] });

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(exitCodes).toStrictEqual([1]);
		expect(mockPublishPlan).not.toHaveBeenCalled();
	});

	test('records the publish step as failed in the planning record when publishing reports an error and exits 1', async () => {
		const { context, planDir, exitCodes } = setupPublishWithPlanFolder({
			report: { published: [], stale: [], error: "nothing to publish for 'demo': no plan found" },
		});

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// the exit throws, so a record read afterwards was written before the command exited
		const record = JSON.parse(readFileSync(join(planDir, 'planning-progress.json'), 'utf8')) as {
			steps: { step: string; status: string }[];
		};

		expect(record.steps.find((entry) => entry.step === 'publish')).toEqual(expect.objectContaining({ step: 'publish', status: 'failed' }));
		expect(exitCodes).toStrictEqual([1]);
	});

	test('records the publish step as passed in the planning record when the publish succeeds and exits 0', async () => {
		const { context, planDir, exitCodes } = setupPublishWithPlanFolder();

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		const record = JSON.parse(readFileSync(join(planDir, 'planning-progress.json'), 'utf8')) as { steps: unknown[] };

		expect(record.steps).toEqual([expect.objectContaining({ step: 'publish', status: 'passed', attempts: 1, pid: process.pid })]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a repo carrying no lightsout.config.json records no publish step, because the refusal comes before any publishing work', async () => {
		const { context, planDir } = setupPublishWithPlanFolder({ withConfig: false });

		await expect(planPublishCommand(context)).rejects.toThrow(/lightsout\.config\.json not found/);

		expect(existsSync(join(planDir, 'planning-progress.json'))).toBe(false);
	});

	test('planPublishCommand: for a plan address, publishes through the ticket record and exits 0', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupTicketPublish();

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// the plan address reaches the ticket publisher as `address`, with the
		// repo's own tracker block, and the legacy publisher is left alone
		expect(mockPublishTicketPlan.mock.calls[0]?.[0]).toMatchObject({
			cwd,
			address: 'lo-9-x/001-a',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
			onProgress: expect.any(Function),
		});
		expect(mockPublishPlan).not.toHaveBeenCalled();
		expect(logged[0]).toBe('\nplan publish lo-9-x/001-a — 4 file(s) attached to LO-9');
		expect(logged.slice(1, 5)).toStrictEqual(['  001-a--plan.md', '  001-a--decisions.json', `  001-a--${planAttachmentManifestName}`, '  state.json']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('planPublishCommand: for a plan address, exits 1 and records the step failed when state.json could not be published', async () => {
		const { context, planDir, logged, errors, exitCodes } = setupTicketPublish({
			report: {
				ticketRef: 'LO-9',
				published: ['001-a--plan.md', `001-a--${planAttachmentManifestName}`],
				stale: [],
				recordError: 'the plan files are on LO-9, but state.json was refused by the tracker',
			},
		});

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// the exit throws, so a record read afterwards was written before the command exited
		const record = JSON.parse(readFileSync(join(planDir, 'planning-progress.json'), 'utf8')) as {
			steps: { step: string; status: string }[];
		};

		// the plan's files did land, so they are still listed; only the record's
		// own sentence goes to stderr, and the step is failed because the ticket
		// record does not say the plan was published
		expect(logged.slice(1, 3)).toStrictEqual(['  001-a--plan.md', `  001-a--${planAttachmentManifestName}`]);
		expect(errors[0] ?? '').toContain('state.json was refused by the tracker');
		expect(record.steps.find((entry) => entry.step === 'publish')).toEqual(expect.objectContaining({ step: 'publish', status: 'failed' }));
		expect(exitCodes).toStrictEqual([1]);
	});

	test('planPublishCommand: names state.json as the file the publish could not land', async () => {
		const { context, logged, errors, exitCodes } = setupTicketPublish({
			report: {
				ticketRef: 'LO-9',
				published: ['001-a--plan.md', `001-a--${planAttachmentManifestName}`],
				stale: [],
				recordError: 'the plan files are on LO-9, but state.json was refused by the tracker',
			},
		});

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// the files that did land are still listed, the state file is not among
		// them, and the sentence on stderr names it by the name it is written under
		expect(logged.slice(1, 3)).toStrictEqual(['  001-a--plan.md', `  001-a--${planAttachmentManifestName}`]);
		expect(logged.join('\n')).not.toContain('state.json');
		expect(errors[0] ?? '').toContain('state.json');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('planPublishCommand: a legacy folder name never reaches the ticket record', async () => {
		const { context, cwd, exitCodes } = setupPublishWithPlanFolder();

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// a folder named for its branch alone keeps today's publish, under bare
		// titles: no plan id prefix, and no ticket record touched
		expect(mockPublishPlan.mock.calls[0]?.[0]).toMatchObject({ cwd, name: 'demo' });
		expect(mockPublishPlan.mock.calls[0]?.[0]?.titlePrefix).toBeUndefined();
		expect(mockPublishTicketPlan).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	// The activity record lands in the same plan folder as the planning record.
	// Publishing spawns no agent, so its command run is a leaf: the level's own
	// time is the whole of what it records, and a child under it would be a step
	// that never ran.
	test('records the publish as a childless command run in the activity record, beside the planning record', async () => {
		const { context, planDir, exitCodes } = setupPublishWithPlanFolder();

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		// the exit throws, so a record read afterwards was written before the command exited
		const report = buildActivityTree({ plan: 'demo', marks: await readActivityMarks({ dir: planDir }) });
		const planning = JSON.parse(readFileSync(join(planDir, 'planning-progress.json'), 'utf8')) as unknown;

		expect(report.roots).toEqual([
			expect.objectContaining({
				level: 'plan',
				startedAt: expect.any(String),
				endedAt: expect.any(String),
				processes: [],
				children: [
					expect.objectContaining({
						level: 'command-run',
						label: expect.stringMatching(/publish/),
						startedAt: expect.any(String),
						endedAt: expect.any(String),
						outcome: 'passed',
						processes: [],
						children: [],
					}),
				],
			}),
		]);
		expect(planning).toEqual(expect.objectContaining({ steps: [expect.objectContaining({ step: 'publish', status: 'passed' })] }));
		expect(exitCodes).toStrictEqual([0]);
	});

	test('ends the command run failed in the activity record when publishing reports an error, and exits 1', async () => {
		const { context, planDir, exitCodes } = setupPublishWithPlanFolder({
			report: { published: [], stale: [], error: "nothing to publish for 'demo': no plan found" },
		});

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		const report = buildActivityTree({ plan: 'demo', marks: await readActivityMarks({ dir: planDir }) });

		// the command run's own outcome agrees with the exit code the command then returns
		expect(report.roots[0]?.children).toEqual([expect.objectContaining({ level: 'command-run', outcome: 'failed', endedAt: expect.any(String) })]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a plan whose files landed but whose ticket record did not ends the command run failed in the activity record', async () => {
		const { context, planDir, exitCodes } = setupTicketPublish({
			report: {
				ticketRef: 'LO-9',
				published: ['001-a--plan.md'],
				stale: [],
				recordError: 'the plan files are on LO-9, but state.json was refused by the tracker',
			},
		});

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		const report = buildActivityTree({ plan: 'lo-9-x/001-a', marks: await readActivityMarks({ dir: planDir }) });

		// nothing on the ticket says which generation the files are, so the
		// command run reads failed even though the attachments did land
		expect(report.roots[0]?.children).toEqual([expect.objectContaining({ level: 'command-run', outcome: 'failed' })]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a repo carrying no lightsout.config.json writes no activity record, because the refusal comes before any work', async () => {
		const { context, planDir } = setupPublishWithPlanFolder({ withConfig: false });

		await expect(planPublishCommand(context)).rejects.toThrow(/lightsout\.config\.json not found/);

		expect(existsSync(activityRecordPath({ dir: planDir }))).toBe(false);
	});

	test('a publish without --name writes no activity record, because the refusal comes before the plan folder is resolved', async () => {
		const { context, cwd, exitCodes } = setupPublish({ args: [] });

		await expect(planPublishCommand(context)).rejects.toThrow(/process\.exit/);

		expect(existsSync(activityRecordPath({ dir: join(cwd, '.lightsout', 'tickets', 'demo', 'plans') }))).toBe(false);
		expect(exitCodes).toStrictEqual([1]);
	});
});
