import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { type GateLockOutcome, withGateLock } from '#src/gates/gateLock/index.ts';

/** Permission bits do not apply to root, so a folder nothing can be written in cannot be arranged there. */
// Jest has no per-call `{ skip }` option, so the choice is made at the call site.
const testUnlessRoot = process.getuid?.() === 0 ? test.skip : test;

// A folder made read-only mid-test must be writable again, or its temp tree can
// never be cleared. Recorded at file scope so one hook restores every one.
const lockedDirs: string[] = [];

afterEach(() => {
	for (const dir of lockedDirs.splice(0)) {
		chmodSync(dir, 0o755);
	}
});

interface SetupParams {
	/** Plant bytes at the reservation path that will not parse — a half-finished write. */
	corrupt?: boolean;
	/** Which folder loses write permission: the shared `.lightsout`, or the checkout that would hold it. */
	readOnly?: 'stateDir' | 'checkout';
	/** Point the run at a checkout that was never created. */
	missingCheckout?: boolean;
}

/**
 * A run whose shared reservation folder is unusable, in the three shapes an
 * operator meets: a leftover nothing can move aside, a checkout that is not
 * there, and a checkout no folder can be created in.
 *
 * The folder is resolved for real rather than mocked — a temp directory belongs
 * to no repository, so git answers nothing and the run's own `.lightsout` is the
 * shared one, which is exactly the fallback these cases have to meet.
 */
const setupSharedFolder = ({ corrupt = false, readOnly, missingCheckout = false }: SetupParams = {}) => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-gate-folder-'));
	const cwd = missingCheckout ? join(root, 'checkout-that-is-not-there') : root;
	const stateDir = join(cwd, '.lightsout');
	const entered: string[] = [];

	if (corrupt) {
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(join(stateDir, 'gate-lock.json'), 'half a wri', 'utf8');
	}

	if (readOnly !== undefined) {
		const locked = readOnly === 'stateDir' ? stateDir : cwd;

		chmodSync(locked, 0o555);
		lockedDirs.push(locked);
	}

	return {
		cwd,
		stateDir,
		lockPath: join(stateDir, 'gate-lock.json'),
		entered,
		/** The gate run itself — a reservation that was refused must never enter it. */
		runBody: async () => {
			entered.push('gates ran');

			return 'gates ran';
		},
	};
};

/** The refusal sentence, or an empty string when the machine was taken after all. */
const reasonOf = ({ outcome }: { outcome: GateLockOutcome<unknown> }): string => ('coordination' in outcome ? outcome.coordination : '');

describe('withGateLock', () => {
	testUnlessRoot('names an unreadable reservation rather than inventing a holder', async () => {
		const { cwd, lockPath, entered, runBody } = setupSharedFolder({ corrupt: true, readOnly: 'stateDir' });

		const outcome = await withGateLock({ cwd, runId: 'run-b', waitCeilingMs: 0, run: runBody });

		// the leftover could not be moved aside, so the machine stays taken — and the
		// only honest thing to say about a document nobody can read is that nobody
		// could read it, never a run id and a worktree made up to fill the sentence
		expect(reasonOf({ outcome })).toContain('could not be read');
		expect({ entered, leftInPlace: existsSync(lockPath) }).toStrictEqual({ entered: [], leftInPlace: true });
	});

	test('refuses without creating a checkout that is not there', async () => {
		const { cwd, entered, runBody } = setupSharedFolder({ missingCheckout: true });

		const outcome = await withGateLock({ cwd, runId: 'run-a', waitCeilingMs: 0, run: runBody });

		// a missing working directory is the real fault: fabricating it here would
		// let the gates report green from inside an empty folder nobody asked for
		expect(reasonOf({ outcome })).toContain('ENOENT');
		expect({ entered, fabricated: existsSync(cwd) }).toStrictEqual({ entered: [], fabricated: false });
	});

	testUnlessRoot('reports the shared folder it could not create rather than running the gates uncoordinated', async () => {
		const { cwd, stateDir, entered, runBody } = setupSharedFolder({ readOnly: 'checkout' });

		const outcome = await withGateLock({ cwd, runId: 'run-a', waitCeilingMs: 0, run: runBody });

		// the folder is newly resolved to the primary checkout, so a repository that
		// works today can meet one it may not write — and it meets it as a stop it
		// can read, never as gates run outside the reservation
		expect(reasonOf({ outcome })).toContain('EACCES');
		expect({ entered, created: existsSync(stateDir) }).toStrictEqual({ entered: [], created: false });
	});
});
