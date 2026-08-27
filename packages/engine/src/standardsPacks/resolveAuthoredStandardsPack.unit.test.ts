import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { resolveAuthoredStandardsPack } from '#src/standardsPacks/index.ts';

/** Marks a folder as a pack root — only the file's presence decides, never its contents. */
const writeManifestIn = ({ folder }: { folder: string }) => {
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'lightsout-standards.json'), '{ "name": "authored", "formatVersion": 1 }\n');
};

/**
 * A temp repo with any of the three folders this resolver looks in.
 *
 * The whole suite runs with LIGHTSOUT_DEFAULT_STANDARDS pointing at this repo's
 * own authored pack (see tooling/jest/setupTestEnvironment.ts). Left standing it
 * would answer every case below before the temp tree was ever looked at, so the
 * factory replaces the environment outright — restoreMocks puts the real one
 * back after each test.
 */
const setupRepo = ({ monorepoPack = false, repoIsPack = false, named }: { monorepoPack?: boolean; repoIsPack?: boolean; named?: 'pack' | 'notAPack' } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-authored-pack-'));
	const monorepoPath = join(cwd, 'packages', 'standards-typescript');
	const namedPath = join(cwd, 'named-folder');
	const environment = { ...process.env };

	if (monorepoPack) {
		writeManifestIn({ folder: monorepoPath });
	}

	if (repoIsPack) {
		writeManifestIn({ folder: cwd });
	}

	delete environment.LIGHTSOUT_DEFAULT_STANDARDS;

	if (named !== undefined) {
		mkdirSync(namedPath, { recursive: true });

		if (named === 'pack') {
			writeManifestIn({ folder: namedPath });
		}

		environment.LIGHTSOUT_DEFAULT_STANDARDS = namedPath;
	}

	jest.replaceProperty(process, 'env', environment);

	return { cwd, monorepoPath, namedPath };
};

describe('resolveAuthoredStandardsPack', () => {
	test("finds this monorepo's authored pack under packages/standards-typescript", () => {
		const { cwd, monorepoPath } = setupRepo({ monorepoPack: true });

		const packPath = resolveAuthoredStandardsPack({ cwd });

		expect(packPath).toBe(monorepoPath);
	});

	test('finds the repo itself when the repo IS a pack', () => {
		const { cwd } = setupRepo({ repoIsPack: true });

		const packPath = resolveAuthoredStandardsPack({ cwd });

		expect(packPath).toBe(cwd);
	});

	test('prefers the pack under packages/ to a manifest at the repo root', () => {
		const { cwd, monorepoPath } = setupRepo({ monorepoPack: true, repoIsPack: true });

		const packPath = resolveAuthoredStandardsPack({ cwd });

		// both exist, so this pins the order rather than mere resolution
		expect(packPath).toBe(monorepoPath);
	});

	test('takes the pack the environment names ahead of anything beside the repo', () => {
		const { cwd, namedPath } = setupRepo({ monorepoPack: true, repoIsPack: true, named: 'pack' });

		const packPath = resolveAuthoredStandardsPack({ cwd });

		expect(packPath).toBe(namedPath);
	});

	test('walks on to the folders beside the repo when the named folder holds no manifest', () => {
		const { cwd, monorepoPath } = setupRepo({ monorepoPack: true, named: 'notAPack' });

		const packPath = resolveAuthoredStandardsPack({ cwd });

		// unlike resolveDefaultStandardsPack, which refuses: here a miss is a
		// fallback to the shipped copy, not a run checking the wrong rules
		expect(packPath).toBe(monorepoPath);
	});

	test('answers with nothing when no authored pack sits beside the repo', () => {
		const { cwd } = setupRepo();

		const packPath = resolveAuthoredStandardsPack({ cwd });

		// the normal case on any repo that is neither this monorepo nor a pack —
		// the caller falls back to the copy the engine ships
		expect(packPath).toBeUndefined();
	});
});
