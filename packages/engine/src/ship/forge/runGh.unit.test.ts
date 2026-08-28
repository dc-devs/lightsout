import { describe, expect, test } from '@jest/globals';
import { runGh } from '#src/ship/forge/runGh.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** A repo with a fake `gh` in front of it, answering one canned response to everything. */
const setupForge = ({ stdout = 'ok', exitCode = 0 }: { stdout?: string; exitCode?: number } = {}) => {
	const { readForgeLog } = stubForgeOnPath({ responses: { '': { stdout, exitCode } } });
	const { cwd } = setupBranchRepo();

	return { cwd, readForgeLog };
};

describe('runGh', () => {
	test('hands the arguments to gh verbatim, spaces and quotes included', async () => {
		const { cwd, readForgeLog } = setupForge();

		await runGh({ args: ['pr', 'edit', '7', '--body', "Closes LO-7 — it's done"], cwd });

		expect(readForgeLog()).toStrictEqual(["pr edit 7 --body Closes LO-7 — it's done"]);
	});

	test('answers with what gh wrote, so a caller reads the JSON rather than the exit code', async () => {
		const { cwd } = setupForge({ stdout: '[{"number":7}]' });

		const result = await runGh({ args: ['pr', 'list'], cwd });

		expect(result).toStrictEqual({ exitCode: 0, stdout: '[{"number":7}]', stderr: '' });
	});

	test('a non-zero exit is a value rather than an exception, matching what the process primitive promises', async () => {
		const { cwd } = setupForge({ stdout: '', exitCode: 4 });

		const result = await runGh({ args: ['pr', 'view', '7'], cwd });

		expect(result.exitCode).toBe(4);
	});

	test('a process that cannot even be started answers exit -1 carrying the message, so no caller needs a try/catch', async () => {
		const result = await runGh({ args: ['auth', 'status'], cwd: '/lightsout/no/such/directory' });

		expect(result).toEqual(expect.objectContaining({ exitCode: -1, stdout: '' }));
		expect(result.stderr.length).toBeGreaterThan(0);
	});
});
