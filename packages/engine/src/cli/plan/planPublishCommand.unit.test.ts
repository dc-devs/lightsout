import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planPublishCommand } from '#src/cli/plan/planPublishCommand.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planAttachmentManifestName } from '#src/plan/common/constants/planAttachmentManifestName.ts';
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
}

const mockPublishPlan = jest.fn<(params: PublishParams) => Promise<PublishReport>>();

jest.mock('#src/plan/index.ts', () => ({
	...jest.requireActual<typeof import('#src/plan/index.ts')>('#src/plan/index.ts'),
	publishPlan: (params: PublishParams) => mockPublishPlan(params),
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
	const planDir = join(published.cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(planDir, { recursive: true });

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
});
