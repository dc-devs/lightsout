/**
 * @jest-environment node
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { isNotFound } from '@tanstack/react-router';
import { requireLocalRepoRoot } from '#src/common/utils/requireLocalRepoRoot.ts';

/** A working directory with a lightsout repo at it, or with none above it. */
const setupWorkingDirectory = ({ repo = true, publicSite = false }: { repo?: boolean; publicSite?: boolean } = {}) => {
	const working = mkdtempSync(join(tmpdir(), 'lightsout-require-repo-root-'));

	if (repo) {
		writeFileSync(join(working, 'lightsout.config.json'), '{}');
	}

	jest.spyOn(process, 'cwd').mockReturnValue(working);

	if (publicSite) {
		process.env.LIGHTSOUT_PUBLIC = '1';
	}

	return { working };
};

/** What the gate threw, so a test can assert on a refusal that is not always an `Error`. */
const catchRefusal = (): unknown => {
	try {
		requireLocalRepoRoot();
	} catch (error) {
		return error;
	}

	throw new Error('requireLocalRepoRoot answered where it should have refused');
};

afterEach(() => {
	jest.restoreAllMocks();
	delete process.env.LIGHTSOUT_PUBLIC;
});

describe('requireLocalRepoRoot', () => {
	test('answers the repo found above the working directory on a local dev server', () => {
		const { working } = setupWorkingDirectory();

		const repoRoot = requireLocalRepoRoot();

		expect(repoRoot).toBe(working);
	});

	test('refuses with the router’s not-found signal on the public site, even inside a repo', () => {
		setupWorkingDirectory({ publicSite: true });

		const refusal = catchRefusal();

		expect(isNotFound(refusal)).toBe(true);
	});

	test('names the folder it searched and the fix when a local server was started outside any repo', () => {
		const { working } = setupWorkingDirectory({ repo: false });

		const refusal = catchRefusal();

		expect(refusal).toStrictEqual(
			new Error(
				`No lightsout.config.json was found in ${working} or any folder above it. Start the app from inside a lightsout repo, or set LIGHTSOUT_REPO to one.`,
			),
		);
	});
});
