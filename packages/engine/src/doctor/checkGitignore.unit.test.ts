import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { checkGitignore } from '#src/doctor/checkGitignore.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('checkGitignore', () => {
	test('passes when git itself says the run state is ignored', async () => {
		const cwd = setupConsumerRepo();

		// the bare spelling, no trailing slash — one of a dozen valid forms that
		// line-matching a .gitignore would get wrong
		writeFileSync(join(cwd, '.gitignore'), '.lightsout\n');

		const check = await checkGitignore({ cwd });

		expect(check.status).toBe('pass');
	});

	test('names what is not ignored so the fix is obvious', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, '.gitignore'), 'node_modules\n');

		const check = await checkGitignore({ cwd });

		expect(check.status).toBe('warn');
		expect(check.detail).toMatch(/run state not ignored/);
	});

	test('a repo that ignores its runs but not its plans is warned about the plans tree', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, '.gitignore'), '.lightsout/runs/\n');

		const check = await checkGitignore({ cwd });

		// plans are run state too — without the rule the consumer commits every one
		expect(check.status).toBe('warn');
		expect(check.fix).toContain('.lightsout/plans/');
	});

	test('a directory outside any repository is reported as unevaluated, not as clean', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const check = await checkGitignore({ cwd });

		// silence here would read as "ignored", which is the opposite of the truth
		expect(check.status).toBe('warn');
		expect(check.detail).toMatch(/not a git repository/);
	});

	test('a directory that does not exist is unevaluated rather than a crash', async () => {
		const check = await checkGitignore({ cwd: '/lightsout/no/such/directory' });

		expect(check.detail).toMatch(/not a git repository/);
	});
});
