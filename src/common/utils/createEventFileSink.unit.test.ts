import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { createEventFileSink } from '@/common/utils/createEventFileSink';

const setupSink = ({ ready, subdir }: { ready?: Promise<unknown>; subdir?: string } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-eventsink-'));
	const path = join(subdir ? join(dir, subdir) : dir, 'stream.jsonl');
	const sink = createEventFileSink({ path, ...(ready ? { ready } : {}) });

	return { dir, path, sink };
};

/**
 * The sink returns void, so a test has no handle on its promise tail. Poll until
 * the file satisfies `until` rather than guessing at a delay — a fixed sleep is
 * what would make a test like this flaky.
 */
const readEventsWhen = async ({ path, until }: { path: string; until: (events: Record<string, unknown>[]) => boolean }) => {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		const events = existsSync(path)
			? readFileSync(path, 'utf8')
					.trim()
					.split('\n')
					.filter(Boolean)
					.map((line) => JSON.parse(line) as Record<string, unknown>)
			: [];

		if (until(events)) {
			return events;
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 2);
		});
	}

	throw new Error(`${path} never satisfied the condition`);
};

const hasCount = (count: number) => (events: Record<string, unknown>[]) => events.length >= count;

describe('createEventFileSink', () => {
	test('events land in arrival order even though every emit returns synchronously', async () => {
		const { path, sink } = setupSink();

		for (let index = 0; index < 50; index += 1) {
			sink({ index });
		}

		const events = await readEventsWhen({ path, until: hasCount(50) });

		// The whole point of the promise tail: unserialized appends interleave and
		// the transcript stops being usable as the run's evidence.
		expect(events.map((event) => event.index)).toStrictEqual(Array.from({ length: 50 }, (_, index) => index));
	});

	test('each event is one JSON line, written verbatim', async () => {
		const { path, sink } = setupSink();

		sink({ type: 'assistant', message: 'editing' });
		sink({ type: 'result', result: 'done' });

		const events = await readEventsWhen({ path, until: hasCount(2) });

		expect(events).toStrictEqual([
			{ type: 'assistant', message: 'editing' },
			{ type: 'result', result: 'done' },
		]);
	});

	test('no append is attempted until ready settles', async () => {
		let release = () => {};
		const ready = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { dir, path, sink } = setupSink({ ready, subdir: 'agents' });

		sink({ first: true });

		// ready is the directory-creation slot: while it is pending the sink must
		// queue rather than write, or the first events hit a directory that is not
		// there yet.
		// the queued event stays unwritten while ready is pending
		expect(existsSync(path)).toBe(false);

		mkdirSync(join(dir, 'agents'), { recursive: true });
		release();

		const events = await readEventsWhen({ path, until: hasCount(1) });

		expect(events).toStrictEqual([{ first: true }]);
	});

	test('a rejected ready is swallowed and the queued events still land in order', async () => {
		const { dir, path, sink } = setupSink({ ready: Promise.reject(new Error('mkdir failed')), subdir: 'agents' });

		mkdirSync(join(dir, 'agents'), { recursive: true });

		sink({ index: 0 });
		sink({ index: 1 });

		const events = await readEventsWhen({ path, until: hasCount(2) });

		// A directory the engine failed to create must not wedge the sink or raise
		// an unhandled rejection — evidence is best-effort, never fatal to a run.
		expect(events.map((event) => event.index)).toStrictEqual([0, 1]);
	});

	test('an append that fails leaves the sink usable for later events', async () => {
		const { dir, path, sink } = setupSink({ subdir: 'agents' });

		// This append targets a directory that does not exist yet, so it rejects.
		sink({ index: 0 });

		mkdirSync(join(dir, 'agents'), { recursive: true });
		sink({ index: 1 });

		// Whether the first append loses its race with mkdir is the test's timing,
		// not the sink's contract — what the catch guarantees is that a failed
		// append does not stall the tail, so the later event always arrives.
		const events = await readEventsWhen({ path, until: (written) => written.some((event) => event.index === 1) });

		// whatever landed is still in arrival order
		expect(events.map((event) => event.index)).toStrictEqual(events.map((event) => event.index).sort((left, right) => Number(left) - Number(right)));
	});
});
