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

	test('a trailing-slash spelling is ignored just as the bare one is', async () => {
		const cwd = setupConsumerRepo();

		// the probe asks about a path inside the folder, so a directory-only entry
		// answers the same as the bare name — the reason the check asks git at all
		writeFileSync(join(cwd, '.gitignore'), '.lightsout/\n');

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

	test('checkGitignore: a repository ignoring only the runs folder is warned, naming the one entry that fixes it', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, '.gitignore'), '.lightsout/runs/\n');

		const check = await checkGitignore({ cwd });

		// one entry and no other — a per-folder list is what drifts out of step with
		// the layout, which is why the guidance collapsed to the state directory
		const fixEntries = (check.fix ?? '').split('\n').filter((line) => line.startsWith('.lightsout'));

		expect(check.status).toBe('warn');
		expect(fixEntries).toEqual(['.lightsout']);
		expect(check.detail).not.toMatch(/\.lightsout\//);
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

	test('checkGitignore: passes when git says the whole state directory is ignored', async () => {
		const cwd = setupConsumerRepo();

		// the one entry the shipped guidance now recommends — nothing under the state
		// directory is meant to be tracked, so nothing is left for a consumer to add
		writeFileSync(join(cwd, '.gitignore'), '.lightsout\n');

		const check = await checkGitignore({ cwd });

		expect(check.status).toBe('pass');
		expect(check.fix).toBeUndefined();
	});
});
