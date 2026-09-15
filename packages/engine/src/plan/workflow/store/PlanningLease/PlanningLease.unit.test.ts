import { mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningLease } from '#src/plan/workflow/store/index.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
const barrier = () => {
	let enter = () => {};
	let release = () => {};
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let enabled = false;
	return {
		entered,
		release,
		enable: () => {
			enabled = true;
		},
		io: {
			checkpoint: async ({ operation }: { operation: string }) => {
				if (enabled && operation === 'lease-candidate') {
					enter();
					await released;
				}
			},
		},
	};
};
const setup = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'planning-lease-'));
	directories.push(cwd);
	const name = 'retry-upload';
	const attemptId = 'attempt';
	let now = 0;
	const ownerPause = barrier();
	const observerPause = barrier();
	const common = { cwd, name, durationMs: 100, now: () => now };
	const owner = new PlanningLease({ ...common, token: 'owner', io: ownerPause.io });
	const observer = new PlanningLease({ ...common, token: 'observer', io: observerPause.io });
	await owner.create({ attemptId });
	const directory = join(cwd, '.lightsout', 'plans', name, '.planning', 'local', `lease-${sha256({ content: attemptId })}`);
	return {
		cwd,
		name,
		attemptId,
		owner,
		observer,
		ownerPause,
		observerPause,
		directory,
		setTime: (time: number) => {
			now = time;
		},
	};
};
const exerciseRace = async ({ context, renewalWins }: { context: Awaited<ReturnType<typeof setup>>; renewalWins: boolean }) => {
	const { owner, observer, attemptId, ownerPause, observerPause, setTime } = context;
	ownerPause.enable();
	observerPause.enable();
	setTime(90);
	const renewal = owner.renew({ attemptId }).then(
		() => 'renewed',
		(error: unknown) => (error instanceof Error ? error.message : String(error)),
	);
	await ownerPause.entered;
	setTime(110);
	const recovery = observer.fenceExpired({ attemptId });
	await observerPause.entered;
	try {
		if (renewalWins) {
			ownerPause.release();
			await renewal;
			observerPause.release();
		} else {
			observerPause.release();
			await recovery;
			ownerPause.release();
		}
		return { renewal: await renewal, recovery: await recovery, stillFenced: await observer.fenceExpired({ attemptId }) };
	} finally {
		ownerPause.release();
		observerPause.release();
	}
};
test.each([true, false])('serializes renewal and expiry fencing through one immutable journal slot', async (renewalWins) => {
	const context = await setup();

	const result = await exerciseRace({ context, renewalWins });

	expect(result).toStrictEqual(
		renewalWins
			? { renewal: 'renewed', recovery: false, stillFenced: false }
			: { renewal: 'A fenced planning lease cannot be revived', recovery: true, stillFenced: true },
	);
});

const setupInvalidJournal = async ({ kind }: { kind: string }) => {
	const context = await setup();
	const path = join(context.directory, '0000000000.json');
	if (kind === 'missing') await rm(path);
	if (kind === 'gap') await rename(path, join(context.directory, '0000000001.json'));
	if (kind === 'checksum') {
		const current = JSON.parse(await readFile(path, 'utf8'));
		await writeFile(path, canonicalJson({ value: { ...current, digest: '0'.repeat(64) } }));
	}
	if (kind === 'symlink') {
		const outside = join(context.cwd, 'outside.json');
		await writeFile(outside, await readFile(path));
		await rm(path);
		await symlink(outside, path);
	}
	context.setTime(110);
	return context;
};
test.each([
	{ kind: 'missing', message: /no verifiable local lease/ },
	{ kind: 'gap', message: /missing predecessor/ },
	{ kind: 'checksum', message: /checksum mismatch/ },
	{ kind: 'symlink', message: /ELOOP/ },
])('refuses recovery when ownership storage cannot be verified', async ({ kind, message }) => {
	const context = await setupInvalidJournal({ kind });

	const result = context.observer.fenceExpired({ attemptId: context.attemptId });

	await expect(result).rejects.toThrow(message);
});

test('keeps a live owner healthy when another process only observes it', async () => {
	const context = await setup();

	const result = await context.observer.fenceExpired({ attemptId: context.attemptId });

	expect({ eligible: result, commits: (await readdir(context.directory)).filter((path) => path.endsWith('.json')) }).toStrictEqual({
		eligible: false,
		commits: ['0000000000.json'],
	});
});

test('refuses a different process incarnation renewing the same attempt', async () => {
	const context = await setup();

	const result = context.observer.renew({ attemptId: context.attemptId });

	await expect(result).rejects.toThrow('A different planning owner cannot renew this attempt');
});

test('refuses late renewal even before another process has fenced the lease', async () => {
	const context = await setup();
	context.setTime(100);

	const result = context.owner.renew({ attemptId: context.attemptId });

	await expect(result).rejects.toThrow('Planning renewal started after recovery became eligible');
});

test('cannot replace an already created ownership journal', async () => {
	const context = await setup();

	const result = context.observer.create({ attemptId: context.attemptId });

	await expect(result).rejects.toThrow('Planning attempt already owns a lease journal');
});
