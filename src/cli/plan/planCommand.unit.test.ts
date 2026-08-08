import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test, jest } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import type { Driver } from '@/drivers';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { planCommand } from '@/cli/plan/planCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

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
const mockResolveConfigAndDriver = jest.fn<(params: unknown) => Promise<{ config?: LightsoutConfig; driver: Driver }>>();
const mockLoadPlanningStandards = jest.fn<(params: unknown) => Promise<string | undefined>>();

// -------------------------

jest.mock('@/cli/plan/planVerifyFactsCommand', () => ({ planVerifyFactsCommand: (params: unknown) => mockPlanVerifyFactsCommand(params) }));
jest.mock('@/cli/plan/planLintCommand', () => ({ planLintCommand: (params: unknown) => mockPlanLintCommand(params) }));
jest.mock('@/cli/plan/planDraftCommand', () => ({ planDraftCommand: (params: unknown) => mockPlanDraftCommand(params) }));
jest.mock('@/cli/plan/planDedupCommand', () => ({ planDedupCommand: (params: unknown) => mockPlanDedupCommand(params) }));
jest.mock('@/cli/plan/planGradeCommand', () => ({ planGradeCommand: (params: unknown) => mockPlanGradeCommand(params) }));
jest.mock('@/cli/common/utils/resolveConfigAndDriver', () => ({ resolveConfigAndDriver: (params: unknown) => mockResolveConfigAndDriver(params) }));
jest.mock('@/cli/plan/loadPlanningStandards', () => ({ loadPlanningStandards: (params: unknown) => mockLoadPlanningStandards(params) }));

const stubDriver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

const setupPlan = ({ args }: { args: string[] }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-command-'));
	const config: LightsoutConfig = { scripts: { check: 'true', testUnit: 'true', testCoverage: false } };

	mockResolveConfigAndDriver.mockResolvedValue({ config, driver: stubDriver });
	mockLoadPlanningStandards.mockResolvedValue('STANDARDS');

	for (const mock of [mockPlanVerifyFactsCommand, mockPlanLintCommand, mockPlanDraftCommand, mockPlanDedupCommand, mockPlanGradeCommand]) {
		mock.mockResolvedValue(undefined);
	}

	return { context: { flags: parseFlags({ args }), rest: args, cwd }, cwd, config, ...captured };
};

/** The first argument the given subcommand was handed. */
const argsOf = (mock: jest.Mock<(params: unknown) => Promise<void>>) => mock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

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
});
