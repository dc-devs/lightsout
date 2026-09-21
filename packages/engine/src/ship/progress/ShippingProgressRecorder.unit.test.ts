import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ShippingProgress, ShippingStepId } from '#src/contracts/index.ts';
import { ShippingProgressRecorder } from '#src/ship/progress/index.ts';
import { runInRepo } from '#tests/helpers/runInRepo.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** When the recorder's clock reads for attempt 1, unless the test moves it on. */
const firstAttemptTime = '2026-09-11T10:00:00.000Z';

/** When a test moves the clock on to, before a later attempt begins. */
const secondAttemptTime = '2026-09-11T10:05:00.000Z';

/** Every step pending, in the order the block draws its rows — what a fresh attempt looks like. */
const allPending = [
	{ id: 'integrate', status: 'pending' },
	{ id: 'push', status: 'pending' },
	{ id: 'pull-request', status: 'pending' },
	{ id: 'checks', status: 'pending' },
	{ id: 'merge', status: 'pending' },
	{ id: 'sync', status: 'pending' },
];

/** Only the clock is faked, so every recorded time is known while the file writes stay real. */
const fakeTheClock = () => {
	jest.useFakeTimers({
		now: new Date(firstAttemptTime),
		doNotFake: [
			'hrtime',
			'nextTick',
			'performance',
			'queueMicrotask',
			'requestAnimationFrame',
			'cancelAnimationFrame',
			'requestIdleCallback',
			'cancelIdleCallback',
			'setImmediate',
			'clearImmediate',
			'setInterval',
			'clearInterval',
			'setTimeout',
			'clearTimeout',
			'Temporal',
		],
	});
};

/** Every line the recorder hands to the console, from any of its channels. */
const captureConsole = () => {
	const printed: unknown[] = [];

	for (const channel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		jest.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
			printed.push(args);
		});
	}

	return printed;
};

/** Run one step from start to finish on the recorder, the way an attempt does. */
const playStep = ({ recorder, step, passed }: { recorder: ShippingProgressRecorder; step: ShippingStepId; passed: boolean }) => {
	recorder.startStep({ step });
	recorder.finishStep({ step, passed });
};

/**
 * A recorder for `feature/lo-7` with a bound of three attempts, over a fresh
 * directory with the clock faked. `ticketFolderIsAFile` puts a plain file where
 * the branch's ticket folder belongs; `ignoreFileIsAFolder` puts a directory
 * where that folder's `.gitignore` belongs. Either way no record can be
 * written, and the console is captured to prove the refusal is silent.
 */
const setupRecorder = ({ ticketFolderIsAFile = false, ignoreFileIsAFolder = false }: { ticketFolderIsAFile?: boolean; ignoreFileIsAFolder?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shipping-progress-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', 'feature-lo-7');
	const recordPath = join(ticketFolder, 'ship-progress.json');

	if (ticketFolderIsAFile) {
		mkdirSync(join(cwd, '.lightsout', 'tickets'), { recursive: true });
		writeFileSync(ticketFolder, 'not a directory\n');
	}

	if (ignoreFileIsAFolder) {
		mkdirSync(join(ticketFolder, '.gitignore'), { recursive: true });
	}

	fakeTheClock();

	const printed = captureConsole();
	const recorder = new ShippingProgressRecorder({ cwd, branch: 'feature/lo-7', maxAttempts: 3 });

	/** The record file as the contract reads it; throws when the file is missing, torn or off-contract. */
	const readRecord = async () => ShippingProgress.parse(JSON.parse(await readFile(recordPath, 'utf8')));

	return { cwd, ticketFolder, recordPath, printed, recorder, readRecord };
};

/**
 * A recorder whose first attempt ran integrate through pull-request green and
 * stopped at red checks, with the clock then moved on — so a second attempt's
 * start time is distinguishable from the first's.
 */
const setupSecondAttempt = () => {
	const recorderSetup = setupRecorder();
	const { recorder } = recorderSetup;

	recorder.beginAttempt({ attempt: 1 });
	playStep({ recorder, step: ShippingStepId.Integrate, passed: true });
	playStep({ recorder, step: ShippingStepId.Push, passed: true });
	playStep({ recorder, step: ShippingStepId.PullRequest, passed: true });
	playStep({ recorder, step: ShippingStepId.Checks, passed: false });
	jest.setSystemTime(new Date(secondAttemptTime));

	return recorderSetup;
};

/**
 * An earlier ship of `feature/lo-7` that ended with integrate passed and a last
 * progress line, then the clock moved on and a second recorder for the same
 * branch in the same checkout — what a later ship of that branch starts from.
 */
const setupLaterShip = async () => {
	const recorderSetup = setupRecorder();
	const { cwd, recorder: earlier } = recorderSetup;

	earlier.beginAttempt({ attempt: 1 });
	playStep({ recorder: earlier, step: ShippingStepId.Integrate, passed: true });
	earlier.noteProgress({ message: 'ship result: .lightsout/tickets/feature-lo-7/ship.json' });
	await earlier.end();
	jest.setSystemTime(new Date(secondAttemptTime));

	return { ...recorderSetup, recorder: new ShippingProgressRecorder({ cwd, branch: 'feature/lo-7', maxAttempts: 3 }) };
};

/**
 * A real git repository on `lo-7-ship` whose own ignore rules say nothing about
 * the lightsout state folder, with a recorder for that branch — the checkout
 * the ship's integration step stages with `git add -A` and restores with
 * `git clean -fd`.
 */
const setupRecorderInRepo = () => {
	const branch = 'lo-7-ship';
	const { cwd } = setupBranchRepo({ branch });
	const recordPath = join(cwd, '.lightsout', 'tickets', 'lo-7-ship', 'ship-progress.json');
	const recorder = new ShippingProgressRecorder({ cwd, branch, maxAttempts: 3 });

	/** What the integration step's three git commands see, in the order it runs them. */
	const observeGit = () => {
		const status = runInRepo({ cwd, command: 'git', args: ['status', '--porcelain', '--untracked-files=all'] });

		runInRepo({ cwd, command: 'git', args: ['add', '-A'] });

		const staged = runInRepo({ cwd, command: 'git', args: ['diff', '--cached', '--name-only'] });

		runInRepo({ cwd, command: 'git', args: ['clean', '-fd'] });

		return { status, staged, recordSurvivesClean: existsSync(recordPath) };
	};

	return { recorder, observeGit };
};

describe('ShippingProgressRecorder', () => {
	test("files a fresh record in the branch's ticket folder with every step pending, and stamps its end", async () => {
		const { ticketFolder, recorder, readRecord } = setupRecorder();

		recorder.beginAttempt({ attempt: 1 });
		await recorder.end();
		const record = await readRecord();

		expect(readdirSync(ticketFolder).sort()).toStrictEqual(['.gitignore', 'ship-progress.json']);
		expect(record).toEqual(
			expect.objectContaining({
				branch: 'feature/lo-7',
				attempt: 1,
				maxAttempts: 3,
				pid: process.pid,
				startedAt: firstAttemptTime,
				endedAt: firstAttemptTime,
				steps: allPending,
			}),
		);
	});

	test('records a finished step as passed or failed with its duration, and a started one as running with its start time', async () => {
		const { recorder, readRecord } = setupRecorder();

		recorder.beginAttempt({ attempt: 1 });
		playStep({ recorder, step: ShippingStepId.Integrate, passed: true });
		playStep({ recorder, step: ShippingStepId.Push, passed: false });
		recorder.startStep({ step: ShippingStepId.PullRequest });
		await recorder.end();
		const record = await readRecord();
		const [integrate, push, pullRequest, ...notReached] = record.steps;

		expect(integrate).toEqual({ id: 'integrate', status: 'passed', startedAt: firstAttemptTime, durationMs: expect.any(Number) });
		expect(integrate?.durationMs).toBeGreaterThanOrEqual(0);
		expect(push).toEqual({ id: 'push', status: 'failed', startedAt: firstAttemptTime, durationMs: expect.any(Number) });
		expect(push?.durationMs).toBeGreaterThanOrEqual(0);
		expect(pullRequest).toEqual({ id: 'pull-request', status: 'running', startedAt: firstAttemptTime });
		expect(notReached).toEqual(allPending.slice(3));
	});

	test("a second attempt puts the five attempt steps back to pending and keeps the record's start time", async () => {
		const { recorder, readRecord } = setupSecondAttempt();

		recorder.beginAttempt({ attempt: 2 });
		await recorder.end();
		const record = await readRecord();

		expect(record).toEqual(expect.objectContaining({ attempt: 2, maxAttempts: 3, startedAt: firstAttemptTime, steps: allPending }));
	});

	test('a later ship of the same branch starts a fresh record over the one an earlier ship left', async () => {
		const { recorder, readRecord } = await setupLaterShip();

		recorder.beginAttempt({ attempt: 1 });
		await recorder.end();
		const record = await readRecord();

		// toEqual, not toStrictEqual, so an absent lastProgress and an undefined one read alike — while a leftover line still fails
		expect(record).toEqual({
			branch: 'feature/lo-7',
			attempt: 1,
			maxAttempts: 3,
			pid: process.pid,
			startedAt: secondAttemptTime,
			updatedAt: secondAttemptTime,
			endedAt: secondAttemptTime,
			lastProgress: undefined,
			steps: allPending,
		});
	});

	test('a step finished with no recorded start is finished with no time spent', async () => {
		const { recorder, readRecord } = setupRecorder();

		recorder.beginAttempt({ attempt: 1 });
		recorder.finishStep({ step: ShippingStepId.Sync, passed: true });
		await recorder.end();
		const record = await readRecord();

		expect(record.steps.at(-1)).toStrictEqual({ id: 'sync', status: 'passed', durationMs: 0 });
	});

	test('keeps the last of many progress lines handed in quick succession', async () => {
		const { recorder, readRecord } = setupRecorder();
		const messages = Array.from({ length: 50 }, (_, index) => `progress line ${index + 1}`);

		recorder.beginAttempt({ attempt: 1 });
		for (const message of messages) {
			recorder.noteProgress({ message });
		}
		await recorder.end();
		const record = await readRecord();

		expect(record.lastProgress).toBe('progress line 50');
	});

	test('a record that cannot be written never throws, prints nothing, and end still resolves', async () => {
		const { recordPath, printed, recorder } = setupRecorder({ ticketFolderIsAFile: true });
		const recordEverything = async () => {
			recorder.beginAttempt({ attempt: 1 });
			recorder.startStep({ step: ShippingStepId.Integrate });
			recorder.finishStep({ step: ShippingStepId.Integrate, passed: false });
			recorder.noteProgress({ message: 'retrying the ship' });
			recorder.beginAttempt({ attempt: 2 });
			await recorder.end();
		};

		const ended = recordEverything();

		await expect(ended).resolves.toBeUndefined();
		expect(printed).toStrictEqual([]);
		expect(existsSync(recordPath)).toBe(false);
	});

	test('the ticket folder ignores itself, so git status, git add -A and git clean -fd never see the record', async () => {
		const { recorder, observeGit } = setupRecorderInRepo();

		recorder.beginAttempt({ attempt: 1 });
		recorder.noteProgress({ message: 'integrating lo-7-ship' });
		await recorder.end();
		const seen = observeGit();

		expect(seen).toStrictEqual({ status: '', staged: '', recordSurvivesClean: true });
	});

	test("skips a record write when the ticket folder's ignore file cannot be written", async () => {
		const { ticketFolder, printed, recorder } = setupRecorder({ ignoreFileIsAFolder: true });

		recorder.beginAttempt({ attempt: 1 });
		const ended = recorder.end();

		await expect(ended).resolves.toBeUndefined();
		expect(readdirSync(ticketFolder)).toStrictEqual(['.gitignore']);
		expect(printed).toStrictEqual([]);
	});

	test("ShippingProgressRecorder: writes ship-progress.json into the branch's ticket folder", async () => {
		const { cwd, recorder } = setupRecorder();
		const ticketFolder = join(cwd, '.lightsout', 'tickets', 'feature-lo-7');
		const recordPath = join(ticketFolder, 'ship-progress.json');

		recorder.beginAttempt({ attempt: 1 });
		await recorder.end();
		const written = await readFile(recordPath, 'utf8');
		const record = ShippingProgress.parse(JSON.parse(written));

		expect(readdirSync(ticketFolder).sort()).toStrictEqual(['.gitignore', 'ship-progress.json']);
		expect(record).toEqual(expect.objectContaining({ branch: 'feature/lo-7', attempt: 1, maxAttempts: 3, startedAt: firstAttemptTime, steps: allPending }));
		expect(existsSync(join(cwd, '.lightsout', 'ship'))).toBe(false);
	});
});
