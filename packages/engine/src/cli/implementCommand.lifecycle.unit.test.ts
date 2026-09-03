import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// Whether the write itself can be made is the guard's own contract, tested
// beside it. What this file pins is what the command does with the guard's
// answer: whether the run is allowed to start at all, and what the guard is
// handed. Every other lifecycle export stays real.
interface GuardParams {
	cwd: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	ticketRef?: string;
	onProgress?: (message: string) => void;
}

const mockRequireImplementLifecycle = jest.fn<(params: GuardParams) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: GuardParams) => mockRequireImplementLifecycle(params),
}));
// -------------------------

/** The sentence a guard that cannot make the write answers with — human-facing copy, matched loosely where it is asserted. */
const refusalSentence =
	"lo-88 could not be moved to 'In Progress' with planning status 'planning-complete': the tracker refused — implement records the ticket's state before it changes any source, so the run stops here";

/**
 * A real consumer repo whose `--plan` names a file that is not there, so a run
 * the guard permits fails fast at the plan read rather than spawning a harness.
 * That failure is one line of stderr the assertions can tell apart from the
 * guard's own refusal, which lands before the banner is ever printed.
 */
const setupImplementLifecycle = ({ args, refusal }: { args: string[]; refusal?: string }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();

	mockRequireImplementLifecycle.mockResolvedValue(refusal);

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('implementCommand pre-source lifecycle guard', () => {
	test('a required pre-source write that could not be made stops the run, and says so in the guard’s own words', async () => {
		const { context, errors, exitCodes } = setupImplementLifecycle({ args: ['--plan', 'ghost.md'], refusal: refusalSentence });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual([refusalSentence]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('the refusal lands before the banner, which is what proves no source work had started', async () => {
		const { context, logged } = setupImplementLifecycle({ args: ['--plan', 'ghost.md'], refusal: refusalSentence });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
	});

	test('a guard that permits the run lets the banner and the pipeline through', async () => {
		const { context, logged, errors, exitCodes } = setupImplementLifecycle({ args: ['--plan', 'ghost.md'] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe('lightsout: starting run');
		expect(errors.some((line) => /plan file not found: .*ghost\.md/.test(line))).toBe(true);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('the guard is handed the checkout and no reference, because implement builds whatever branch the checkout holds', async () => {
		const { context, cwd } = setupImplementLifecycle({ args: ['--plan', 'ghost.md'] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		// asserted whole rather than partially: no `ticketRef` key at all is the
		// point, because this command has no --ref and the guard reads the
		// branch's own ticket reference instead
		expect(mockRequireImplementLifecycle).toHaveBeenCalledWith({ cwd, config: expect.anything(), env: process.env, onProgress: expect.any(Function) });
	});

	test('contradictory ship flags stop the run before any tracker write is attempted', async () => {
		const { context, exitCodes } = setupImplementLifecycle({ args: ['--plan', 'ghost.md', '--ship', '--no-ship'] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		// a usage error must not leave a ticket saying implementation began
		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a plan flag nothing can resolve stops the run before any tracker write is attempted', async () => {
		const { context, exitCodes } = setupImplementLifecycle({ args: ['--skip-refactor'] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});
