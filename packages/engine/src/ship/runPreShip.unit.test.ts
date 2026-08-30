import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { runPreShip } from '#src/ship/runPreShip.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

const setupPreShip = ({ dirty }: { dirty?: Record<string, string> } = {}) => {
	const progress: string[] = [];
	const { cwd } = setupBranchRepo({ branch: 'lo-76-ship', dirty });

	return { cwd, progress, onProgress: (message: string) => progress.push(message) };
};

/** The subject of the newest commit, which is where the step's own commit shows up. */
const readLastSubject = ({ cwd }: { cwd: string }) => execSync('git log -1 --format=%s', { cwd, encoding: 'utf8' }).trim();

/** Uncommitted paths, empty when the tree is clean. */
const readDirtyPaths = ({ cwd }: { cwd: string }) => execSync('git status --porcelain', { cwd, encoding: 'utf8' }).trim();

describe('runPreShip', () => {
	test('runs the command and commits what it changed, so the tree it leaves is shippable', async () => {
		const { cwd, progress, onProgress } = setupPreShip();

		const failure = await runPreShip({ cwd, command: 'echo rebuilt > bundle.txt', onProgress });

		expect(failure).toBe(undefined);
		expect(readLastSubject({ cwd })).toBe('pre-ship');
		expect(readDirtyPaths({ cwd })).toBe('');
		expect(progress).toStrictEqual(['pre-ship: echo rebuilt > bundle.txt', 'pre-ship: committed 1 changed file(s)']);
	});

	test('commits changes the tree already carried, because a gate that regenerated an output is exactly what this step heals', async () => {
		const { cwd, onProgress } = setupPreShip({ dirty: { 'regenerated.txt': 'from a gate\n' } });

		const failure = await runPreShip({ cwd, command: 'true', onProgress });

		expect(failure).toBe(undefined);
		expect(readLastSubject({ cwd })).toBe('pre-ship');
		expect(readDirtyPaths({ cwd })).toBe('');
	});

	test('a command that changes nothing commits nothing — the convention held already, and that is success', async () => {
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
});
