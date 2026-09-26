/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { findRepoRoot } from '#src/common/utils/findRepoRoot.ts';

const setupRepo = ({ nested = false, marker = true, env }: { nested?: boolean; marker?: boolean; env?: string } = {}) => {
	// realpath-insensitive: macOS resolves /var to /private/var, and cwd is read
	// back through the same call the subject uses, so both sides agree.
	const root = mkdtempSync(join(tmpdir(), 'lightsout-find-repo-root-'));
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

describe('findRepoRoot', () => {
	test('takes an absolute LIGHTSOUT_REPO as it stands', () => {
		setupRepo({ env: '/somewhere/else' });

		const repoRoot = findRepoRoot();

		expect(repoRoot).toBe('/somewhere/else');
	});

	test('resolves a relative LIGHTSOUT_REPO against the working directory', () => {
		const { working } = setupRepo({ env: 'sibling' });

		const repoRoot = findRepoRoot();

		expect(repoRoot).toBe(join(working, 'sibling'));
	});

	test('ignores an empty LIGHTSOUT_REPO and walks instead', () => {
		const { root } = setupRepo({ nested: true, env: '' });

		const repoRoot = findRepoRoot();

		expect(repoRoot).toBe(root);
	});

	test('walks up from the working directory to the nearest lightsout.config.json', () => {
		const { root } = setupRepo({ nested: true });

		const repoRoot = findRepoRoot();

		expect(repoRoot).toBe(root);
	});

	test('returns the working directory when it already holds the marker', () => {
		const { root } = setupRepo();

		const repoRoot = findRepoRoot();

		expect(repoRoot).toBe(root);
	});

	test('finds nothing when no ancestor holds the marker, rather than claiming the working directory is a repo', () => {
		setupRepo({ nested: true, marker: false });

		const repoRoot = findRepoRoot();

		expect(repoRoot).toBeUndefined();
	});
});
