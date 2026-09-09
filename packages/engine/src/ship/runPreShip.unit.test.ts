import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { runPreShip } from '#src/ship/runPreShip.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

const setupPreShip = () => {
	const progress: string[] = [];
	const { cwd } = setupBranchRepo({ branch: 'lo-76-ship' });

	return { cwd, progress, onProgress: (message: string) => progress.push(message) };
};

/** The subject of the newest commit, which is where the step's own commit shows up. */
const readLastSubject = ({ cwd }: { cwd: string }) => execSync('git log -1 --format=%s', { cwd, encoding: 'utf8' }).trim();

/** Uncommitted paths as git prints them, whose leading status columns are part of each line. */
const readDirtyPaths = ({ cwd }: { cwd: string }) => execSync('git status --porcelain', { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);

/** The commit HEAD stands on, which is what a preparation step must leave alone. */
const readHeadCommit = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

/** A branch repo plus the commit it started on, so a test can prove HEAD never moved. */
const setupPreparedTree = () => {
	const { cwd, progress, onProgress } = setupPreShip();

	return { cwd, progress, onProgress, baselineCommit: readHeadCommit({ cwd }) };
};

describe('runPreShip', () => {
	test('a command that changes nothing leaves nothing behind — the convention held already, and that is success', async () => {
		const { cwd, progress, onProgress } = setupPreShip();

		const failure = await runPreShip({ cwd, command: 'true', onProgress });

		expect(failure).toBe(undefined);
		expect(readLastSubject({ cwd })).toBe('add the feature');
		expect(progress).toStrictEqual(['pre-ship: true']);
	});

	test('a failing command answers its own words and leaves the tree exactly as it found it', async () => {
		const { cwd, onProgress } = setupPreShip();

		const failure = await runPreShip({ cwd, command: 'echo the bundle would not build && exit 3', onProgress });

		expect(failure?.stderr).toContain('the bundle would not build');
		expect(readLastSubject({ cwd })).toBe('add the feature');
	});

	test('a command that fails without saying anything still fails, with nothing invented as its reason', async () => {
		const { cwd, onProgress } = setupPreShip();

		const failure = await runPreShip({ cwd, command: 'false', onProgress });

		expect(failure).toStrictEqual({ stderr: '' });
	});

	test('leaves prepared changes uncommitted for verification', async () => {
		const { cwd, progress, onProgress, baselineCommit } = setupPreparedTree();

		const failure = await runPreShip({ cwd, command: 'echo rebuilt > bundle.txt && echo more >> feature.md', onProgress });

		expect(failure).toBe(undefined);
		expect(readHeadCommit({ cwd })).toBe(baselineCommit);
		expect(readDirtyPaths({ cwd })).toEqual(expect.arrayContaining(['?? bundle.txt', ' M feature.md']));
		expect(progress.join('\n')).not.toContain('committed');
	});

	test('hands the pinned base commit to the command, so a release convention versions against what ship merged', async () => {
		const { cwd, onProgress } = setupPreShip();

		const failure = await runPreShip({ cwd, command: 'echo "$LIGHTSOUT_SHIP_BASE_COMMIT" > base.txt', baseCommit: 'a1b2c3d4', onProgress });

		expect(failure).toBe(undefined);
		expect(readFileSync(join(cwd, 'base.txt'), 'utf8').trim()).toBe('a1b2c3d4');
	});
});
