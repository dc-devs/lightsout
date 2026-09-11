import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { PlanWorktree } from '#src/cli/plan/common/types/PlanWorktree.ts';
import { planCommand } from '#src/cli/plan/planCommand.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { queueConfigBlock, ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// planCommand is a dispatcher: the only behaviour it owns is which subcommand
// runs and what reaches it. The subcommands are other modules' entry points, so
// they are stubbed rather than driven — running them for real would spawn a
// harness to prove a routing decision.

const mockPlanVerifyFactsCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockPlanLintCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockPlanDraftCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockPlanDedupCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockPlanGradeCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockPlanPublishCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockPlanSyncDecisionsCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockResolveConfigAndDriver = jest.fn<(params: unknown) => Promise<{ config?: LightsoutConfig; driver: Driver }>>();
const mockLoadPlanningStandards = jest.fn<(params: unknown) => Promise<string | undefined>>();

// -------------------------
// The planning worktree is established through git, and its own rules are
// pinned beside the resolver; here only where the dispatcher sends a
// subcommand is under test. The default answer is the launching checkout
// itself, as with isolation off, so every routing case above still reads the
// checkout it was launched from.

type OpenPlanWorktreeParams = { cwd: string; config: LightsoutConfig | undefined; flags: CommandContext['flags']; name: string };

const mockOpenPlanWorktree = jest.fn<(params: OpenPlanWorktreeParams) => Promise<{ worktree: PlanWorktree } | { error: string }>>(async ({ cwd }) => ({
	worktree: { cwd, isolated: false, created: false },
}));

// -------------------------

jest.mock('#src/cli/plan/planVerifyFactsCommand.ts', () => ({ planVerifyFactsCommand: (params: unknown) => mockPlanVerifyFactsCommand(params) }));
jest.mock('#src/cli/plan/planLintCommand.ts', () => ({ planLintCommand: (params: unknown) => mockPlanLintCommand(params) }));
jest.mock('#src/cli/plan/planDraftCommand.ts', () => ({ planDraftCommand: (params: unknown) => mockPlanDraftCommand(params) }));
jest.mock('#src/cli/plan/planDedupCommand.ts', () => ({ planDedupCommand: (params: unknown) => mockPlanDedupCommand(params) }));
jest.mock('#src/cli/plan/planGradeCommand.ts', () => ({ planGradeCommand: (params: unknown) => mockPlanGradeCommand(params) }));
jest.mock('#src/cli/plan/planPublishCommand.ts', () => ({ planPublishCommand: (params: unknown) => mockPlanPublishCommand(params) }));
jest.mock('#src/cli/plan/planSyncDecisionsCommand.ts', () => ({ planSyncDecisionsCommand: (params: unknown) => mockPlanSyncDecisionsCommand(params) }));
jest.mock('#src/cli/common/utils/resolveConfigAndDriver.ts', () => ({ resolveConfigAndDriver: (params: unknown) => mockResolveConfigAndDriver(params) }));
jest.mock('#src/cli/plan/readPlanningStandards.ts', () => ({ readPlanningStandards: (params: unknown) => mockLoadPlanningStandards(params) }));
jest.mock('#src/cli/plan/common/utils/openPlanWorktree.ts', () => ({
	openPlanWorktree: (params: OpenPlanWorktreeParams) => mockOpenPlanWorktree(params),
}));

const stubDriver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

/** The gate block every config in this file carries — the smallest one the contract accepts. */
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/**
 * The config a repo carries when it has chosen a ticket convention: the
 * presence of a `ticket-tracker` block is the whole signal that the plan-folder
 * advisory applies to it.
 */
const trackerRepoConfig = { gates, queue: queueConfigBlock, 'ticket-tracker': ticketTrackerConfigBlock };

/**
 * The same repo with the tracker block taken away: a `queue` block on its own
 * names no tracker, so this repo has chosen no ticket convention.
 */
const queueOnlyRepoConfig = { gates, queue: queueConfigBlock };

const setupPlan = ({ args, repoConfig }: { args: string[]; repoConfig?: Record<string, unknown> }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-command-'));
	const config: LightsoutConfig = { gates };

	if (repoConfig) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(repoConfig));
	}

	mockResolveConfigAndDriver.mockResolvedValue({ config, driver: stubDriver });
	mockLoadPlanningStandards.mockResolvedValue('STANDARDS');

	for (const mock of [
		mockPlanVerifyFactsCommand,
		mockPlanLintCommand,
		mockPlanDraftCommand,
		mockPlanDedupCommand,
		mockPlanGradeCommand,
		mockPlanPublishCommand,
		mockPlanSyncDecisionsCommand,
	]) {
		mock.mockResolvedValue(undefined);
	}

	return { context: { flags: parseFlags({ args }), rest: args, cwd }, cwd, config, ...captured };
};

/** The first argument the given subcommand was handed. */
const argsOf = (mock: jest.Mock<(params: unknown) => Promise<void>>) => mock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

/**
 * The dispatcher launched from one checkout while the plan's worktree stands
 * somewhere else — or, when `refused`, while that worktree cannot be
 * established at all. The answer is queued once, so the one resolution a
 * dispatch makes spends it and no later case inherits it.
 */
const setupWorktree = ({ args, refused = false }: { args: string[]; refused?: boolean }) => {
	const launched = setupPlan({ args });
	const worktreePath = join(tmpdir(), 'lightsout-worktrees', 'demo');
	const worktree: PlanWorktree = { cwd: worktreePath, branch: 'demo', isolated: true, created: true };
	const refusal = `Cannot establish the planning worktree at ${worktreePath}: a file already occupies that path. Pass --no-worktree to plan in the launching checkout deliberately.`;

	mockOpenPlanWorktree.mockResolvedValueOnce(refused ? { error: refusal } : { worktree });

	return { ...launched, worktreePath, refusal };
};

/**
 * `plan workspace` twice over — once with no --name, and once named while its
 * worktree cannot be established. Both contexts share one capture, so a single
 * act dispatches both and every line either wrote is read back.
 */
const setupRefusedWorkspaces = () => {
	const named = setupWorktree({ args: ['workspace', '--name', 'demo'], refused: true });
	const namelessArgs = ['workspace'];

	return { ...named, nameless: { ...named.context, flags: parseFlags({ args: namelessArgs }), rest: namelessArgs } };
};

describe('planCommand', () => {
	test('routes verify-facts without resolving a harness, because it runs no agent', async () => {
		const { context, cwd } = setupPlan({ args: ['verify-facts', '--name', 'demo'] });

		await planCommand(context);

		expect(mockPlanVerifyFactsCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanVerifyFactsCommand)?.cwd).toBe(cwd);
		// a deterministic subcommand must not cost a harness resolution
		expect(mockResolveConfigAndDriver).not.toHaveBeenCalled();
	});

	test('routes lint without resolving a harness either', async () => {
		const { context, cwd } = setupPlan({ args: ['lint', '--name', 'demo'] });

		await planCommand(context);

		expect(mockPlanLintCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanLintCommand)?.cwd).toBe(cwd);
		expect(mockResolveConfigAndDriver).not.toHaveBeenCalled();
	});

	test('routes publish without resolving a harness, because it spawns no agent either', async () => {
		const { context, cwd } = setupPlan({ args: ['publish', '--name', 'lo-54-portable-plan'] });

		await planCommand(context);

		expect(mockPlanPublishCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanPublishCommand)?.cwd).toBe(cwd);
		expect(mockResolveConfigAndDriver).not.toHaveBeenCalled();
	});

	test('routes sync-decisions without resolving a harness, because it runs no agent', async () => {
		const { context, cwd } = setupPlan({ args: ['sync-decisions', '--name', 'demo'] });

		await planCommand(context);

		expect(mockPlanSyncDecisionsCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanSyncDecisionsCommand)?.cwd).toBe(cwd);
		// regenerating the log reads files and writes files — no config, no driver
		expect(mockResolveConfigAndDriver).not.toHaveBeenCalled();
		expect(mockLoadPlanningStandards).not.toHaveBeenCalled();
	});

	test('routes draft with the resolved harness and standards', async () => {
		const { context, cwd, config } = setupPlan({ args: ['draft', '--name', 'demo'] });

		await planCommand(context);

		expect(mockPlanDraftCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanDraftCommand)).toMatchObject({ cwd, name: 'demo', standards: 'STANDARDS', config, driver: stubDriver });
		// there is one plans root, derived from cwd and name — nothing relocatable
		// rides the dispatch, got: ${JSON.stringify(Object.keys(argsOf(mockPlanDraftCommand) ?? {}))}
		expect(argsOf(mockPlanDraftCommand)).not.toHaveProperty('plansDir');
	});

	test('routes dedup', async () => {
		const { context, cwd, config } = setupPlan({ args: ['dedup', '--name', 'demo'] });

		await planCommand(context);

		expect(mockPlanDedupCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanDedupCommand)).toMatchObject({ cwd, name: 'demo', standards: 'STANDARDS', config, driver: stubDriver });
		// dedup finds the plan from cwd and name alone, got: ${JSON.stringify(Object.keys(argsOf(mockPlanDedupCommand) ?? {}))}
		expect(argsOf(mockPlanDedupCommand)).not.toHaveProperty('plansDir');
		expect(mockPlanDraftCommand).not.toHaveBeenCalled();
	});

	test('routes grade', async () => {
		const { context, cwd, config } = setupPlan({ args: ['grade', '--name', 'demo'] });

		await planCommand(context);

		expect(mockPlanGradeCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanGradeCommand)).toMatchObject({ cwd, name: 'demo', standards: 'STANDARDS', config, driver: stubDriver });
		// grade finds the plan from cwd and name alone, got: ${JSON.stringify(Object.keys(argsOf(mockPlanGradeCommand) ?? {}))}
		expect(argsOf(mockPlanGradeCommand)).not.toHaveProperty('plansDir');
		expect(mockPlanDedupCommand).not.toHaveBeenCalled();
	});

	test('grade with no --phase asks for the whole plan', async () => {
		const { context } = setupPlan({ args: ['grade', '--name', 'demo'] });

		await planCommand(context);

		// absent, not empty: an empty list is a request the runner refuses
		expect(argsOf(mockPlanGradeCommand)?.phases).toBe(undefined);
	});

	test('grade splits a comma-separated --phase into trimmed values', async () => {
		const { context } = setupPlan({ args: ['grade', '--name', 'demo', '--phase', '1, phase3-fanout.md ,'] });

		await planCommand(context);

		// a trailing comma contributes nothing; repeats are not collected, because
		// `parseFlags` would silently overwrite the first `--phase`
		expect(argsOf(mockPlanGradeCommand)?.phases).toStrictEqual(['1', 'phase3-fanout.md']);
	});

	test('a --phase that yields no values reaches the runner as an empty list, which it refuses', async () => {
		const { context } = setupPlan({ args: ['grade', '--name', 'demo', '--phase', ','] });

		await planCommand(context);

		// never undefined — that would silently widen a narrowed request to the
		// whole plan
		expect(argsOf(mockPlanGradeCommand)?.phases).toStrictEqual([]);
	});

	test('an unknown subcommand prints the usage text and exits 1', async () => {
		const { context, errors, exitCodes } = setupPlan({ args: ['sideways'] });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('no subcommand at all is the same as an unknown one', async () => {
		const { context, exitCodes } = setupPlan({ args: [] });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([1]);
	});

	test('an agent subcommand without --name fails before resolving a harness', async () => {
		const { context } = setupPlan({ args: ['draft'] });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit|--name/);

		expect(mockPlanDraftCommand).not.toHaveBeenCalled();
	});

	test.each(['draft', 'dedup', 'grade', 'lint', 'publish', 'sync-decisions', 'verify-facts'])(
		'%s addresses a plan by name, so a folder carrying no ticket id draws exactly one advisory and the subcommand still runs',
		async (subcommand) => {
			const { context, logged, exitCodes } = setupPlan({ args: [subcommand, '--name', 'rate-limit-banner'], repoConfig: trackerRepoConfig });

			await planCommand(context);

			expect(logged.filter((line) => /carries no ticket id/.test(line)).length).toBe(1);
			// advisory only: the dispatch ran to its end and nothing exited
			expect(exitCodes).toStrictEqual([]);
		},
	);

	test('a plan folder named after its ticket is told nothing at all', async () => {
		const { context, logged } = setupPlan({ args: ['lint', '--name', 'lo-52-status-progress'], repoConfig: trackerRepoConfig });

		await planCommand(context);

		expect(logged).toStrictEqual([]);
	});

	test('a repo carrying a queue block and no ticket-tracker block is advised nothing, because a queue names no tracker', async () => {
		const { context, logged } = setupPlan({ args: ['lint', '--name', 'rate-limit-banner'], repoConfig: queueOnlyRepoConfig });

		await planCommand(context);

		expect(logged).toStrictEqual([]);
		expect(mockPlanLintCommand).toHaveBeenCalledTimes(1);
	});

	test('a subcommand given no --name has no folder to name, so nothing is advised', async () => {
		const { context, logged } = setupPlan({ args: ['verify-facts'], repoConfig: trackerRepoConfig });

		await planCommand(context);

		expect(logged).toStrictEqual([]);
	});

	test('an unknown subcommand addresses no plan — the usage error stands alone, with no advisory ahead of it', async () => {
		const { context, logged, exitCodes } = setupPlan({ args: ['sideways', '--name', 'rate-limit-banner'], repoConfig: trackerRepoConfig });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test("runs a graded pass in the plan's worktree rather than the checkout it was launched from", async () => {
		const { context, cwd, worktreePath } = setupWorktree({ args: ['grade', '--name', 'demo'] });

		await planCommand(context);

		// the tree is resolved from the launching checkout, and the pass runs in the tree
		expect(mockOpenPlanWorktree).toHaveBeenCalledWith(expect.objectContaining({ cwd, name: 'demo' }));
		expect(argsOf(mockPlanGradeCommand)).toMatchObject({ cwd: worktreePath, name: 'demo' });
	});

	test("dispatches no subcommand when the plan's worktree cannot be established", async () => {
		const { context, errors, exitCodes, refusal } = setupWorktree({ args: ['grade', '--name', 'demo'], refused: true });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		const dispatches = [
			mockPlanVerifyFactsCommand,
			mockPlanLintCommand,
			mockPlanDraftCommand,
			mockPlanDedupCommand,
			mockPlanGradeCommand,
			mockPlanPublishCommand,
			mockPlanSyncDecisionsCommand,
		].reduce((total, mock) => total + mock.mock.calls.length, 0);
		expect(errors.filter((line) => line.includes(refusal))).toHaveLength(1);
		expect(exitCodes).toStrictEqual([1]);
		expect(dispatches).toBe(0);
		expect(mockResolveConfigAndDriver).not.toHaveBeenCalled();
	});

	test('establishes no worktree for a subcommand given no --name', async () => {
		const { context, cwd } = setupPlan({ args: ['lint'] });

		await planCommand(context);

		// lint still receives the launching checkout, where its own --name refusal stands
		expect(mockOpenPlanWorktree).not.toHaveBeenCalled();
		expect(mockPlanLintCommand).toHaveBeenCalledTimes(1);
		expect(argsOf(mockPlanLintCommand)?.cwd).toBe(cwd);
	});

	test('refuses a nameless workspace invocation and a refused tree without dispatching either', async () => {
		const { context, nameless, logged, errors, exitCodes, refusal } = setupRefusedWorkspaces();

		const outcomes = await Promise.allSettled([planCommand(nameless), planCommand(context)]);

		expect(outcomes.map(({ status }) => status)).toStrictEqual(['rejected', 'rejected']);
		// only the named invocation asked for a tree — the nameless one was refused before any
		expect(mockOpenPlanWorktree.mock.calls.map(([params]) => params.name)).toStrictEqual(['demo']);
		expect(errors.filter((line) => /^lightsout — deterministic engine for coding agents/.test(line))).toHaveLength(1);
		expect(errors.filter((line) => line.includes(refusal))).toHaveLength(1);
		// planWorkspaceCommand never ran: no path reached stdout and nothing exited 0
		expect(logged).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1, 1]);
	});
});
