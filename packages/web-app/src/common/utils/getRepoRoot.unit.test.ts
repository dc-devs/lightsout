/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { getRepoRoot } from '#src/common/utils/getRepoRoot.ts';

const setupRepo = ({ nested = false, marker = true, env }: { nested?: boolean; marker?: boolean; env?: string } = {}) => {
	// realpath-insensitive: macOS resolves /var to /private/var, and cwd is read
	// back through the same call the subject uses, so both sides agree.
	const root = mkdtempSync(join(tmpdir(), 'lightsout-repo-root-'));
	const working = nested ? join(root, 'packages', 'web-app') : root;

	mkdirSync(working, { recursive: true });

	if (marker) {
		writeFileSync(join(root, 'lightsout.config.json'), '{}');
	}

	jest.spyOn(process, 'cwd').mockReturnValue(working);

	if (env === undefined) {
		delete process.env.LIGHTSOUT_REPO;
	} else {
		process.env.LIGHTSOUT_REPO = env;
	}

	return { root, working };
};

afterEach(() => {
	delete process.env.LIGHTSOUT_REPO;
});

describe('getRepoRoot', () => {
	test('takes an absolute LIGHTSOUT_REPO as it stands', () => {
		setupRepo({ env: '/somewhere/else' });

		const repoRoot = getRepoRoot();

		expect(repoRoot).toBe('/somewhere/else');
	});

	test('resolves a relative LIGHTSOUT_REPO against the working directory', () => {
		const { working } = setupRepo({ env: 'sibling' });

		const repoRoot = getRepoRoot();

		expect(repoRoot).toBe(join(working, 'sibling'));
	});

	test('ignores an empty LIGHTSOUT_REPO and walks instead', () => {
		const { root } = setupRepo({ nested: true, env: '' });

		const repoRoot = getRepoRoot();

		expect(repoRoot).toBe(root);
	});

	test('walks up from the working directory to the nearest lightsout.config.json', () => {
		const { root } = setupRepo({ nested: true });

		const repoRoot = getRepoRoot();

		expect(repoRoot).toBe(root);
	});

	test('returns the working directory when it already holds the marker', () => {
		const { root } = setupRepo();

		const repoRoot = getRepoRoot();

		expect(repoRoot).toBe(root);
	});

	test('falls back to the working directory when no ancestor holds the marker', () => {
		const { working } = setupRepo({ nested: true, marker: false });

		const repoRoot = getRepoRoot();

		expect(repoRoot).toBe(working);
	});
});
