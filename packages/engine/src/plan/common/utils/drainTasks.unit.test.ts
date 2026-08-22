import { describe, expect, test } from '@jest/globals';
import { drainTasks } from '#src/plan/index.ts';

/** A promise a test settles by hand, so slot scheduling is exercised without leaning on timers. */
const createDeferred = <Value>() => {
	let settle: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((resolve) => {
		settle = resolve;
	});

	return { promise, settle };
};

/** Let every already-queued microtask and I/O callback run, so the drain reaches its next await. */
const flush = () =>
	new Promise<void>((resolve) => {
		setImmediate(resolve);
	});

/**
 * `count` tasks that each park on their own deferred, recording the order they
 * were started in. The test decides which finishes when, which is the only way
 * to observe a slot refilling rather than a batch draining.
 */
const setupParkedTasks = ({ count }: { count: number }) => {
	const started: number[] = [];
	const gates = Array.from({ length: count }, () => createDeferred<string>());
	const tasks = gates.map((gate, index) => () => {
		started.push(index);

		return gate.promise;
	});

	return { started, gates, tasks };
};

describe('drainTasks', () => {
	test('results come back by task index, never by completion order', async () => {
		const { gates, tasks } = setupParkedTasks({ count: 3 });

		const drained = drainTasks({ tasks, concurrency: 3 });

		await flush();
		// finish backwards: a caller labels a result by where it sat in the list
		gates[2].settle('third');
		gates[1].settle('second');
		gates[0].settle('first');

		expect(await drained).toStrictEqual(['first', 'second', 'third']);
	});

	test('no more than `concurrency` tasks are ever in flight, and a freed slot refills at once', async () => {
		const { started, gates, tasks } = setupParkedTasks({ count: 5 });

		const drained = drainTasks({ tasks, concurrency: 2 });

		await flush();

		const openingWave = [...started];

		gates[0].settle('a');
		await flush();

		const afterOneFreed = [...started];

		for (const gate of gates) {
			gate.settle('done');
		}
		await drained;

		// two slots open, and the third task starts the moment the first frees —
		// not when the whole opening wave has returned
		expect({ openingWave, afterOneFreed }).toStrictEqual({ openingWave: [0, 1], afterOneFreed: [0, 1, 2] });
	});

	test('a concurrency above the task count opens one slot per task and no more', async () => {
		const { started, gates, tasks } = setupParkedTasks({ count: 2 });

		const drained = drainTasks({ tasks, concurrency: 8 });

		await flush();

		const openingWave = [...started];

		for (const gate of gates) {
			gate.settle('done');
		}

		expect({ openingWave, results: await drained }).toStrictEqual({ openingWave: [0, 1], results: ['done', 'done'] });
	});

	test('shouldStop halts new starts, leaving every task it never claimed undefined', async () => {
		const tasks = Array.from({ length: 4 }, (_, index) => async () => `task-${index}`);
		const started: number[] = [];
		const counted = tasks.map((task, index) => () => {
			started.push(index);

			return task();
		});

		const results = await drainTasks({ tasks: counted, concurrency: 1, shouldStop: ({ results: settled }) => settled.some((result) => result !== undefined) });

		// `undefined` is what tells a caller "never ran" apart from "ran and
		// answered nothing" — the distinction a park report turns on
		expect({ started, results }).toStrictEqual({ started: [0], results: ['task-0', undefined, undefined, undefined] });
	});

	test('a task already in flight when shouldStop turns true still finishes and still lands', async () => {
		const slow = createDeferred<string>();
		const tasks = [async () => 'stop', () => slow.promise, async () => 'never', async () => 'never'];

		const drained = drainTasks({ tasks, concurrency: 2, shouldStop: ({ results }) => results.includes('stop') });

		await flush();
		slow.settle('finished anyway');

		// the caller always sees a settled set: stopping is about new starts, not
		// about abandoning work already paid for
		expect(await drained).toStrictEqual(['stop', 'finished anyway', undefined, undefined]);
	});

	test('an empty task list drains to an empty result without opening a slot or consulting shouldStop', async () => {
		let consulted = 0;

		const results = await drainTasks<string>({
			tasks: [],
			concurrency: 4,
			shouldStop: () => {
				consulted += 1;

				return false;
			},
		});

		expect({ results, consulted }).toStrictEqual({ results: [], consulted: 0 });
	});

	test('a shouldStop that never fires drains the whole list', async () => {
		const tasks = Array.from({ length: 6 }, (_, index) => async () => index);

		const results = await drainTasks({ tasks, concurrency: 2, shouldStop: () => false });

		expect(results).toStrictEqual([0, 1, 2, 3, 4, 5]);
	});

	test('a hole in the task list leaves that index undefined rather than throwing', async () => {
		// The list is typed as dense, so only a double cast can produce this — the
		// guard exists so one missing thunk cannot take the whole drain down.
		const tasks = [async () => 'first', undefined as unknown as () => Promise<string>, async () => 'third'];

		const results = await drainTasks({ tasks, concurrency: 2 });

		expect(results).toStrictEqual(['first', undefined, 'third']);
	});

	test('a rejecting task propagates out of the drain rather than being swallowed', async () => {
		const tasks = [async () => 'fine', async () => Promise.reject(new Error('spawn failed'))];

		await expect(drainTasks({ tasks, concurrency: 2 })).rejects.toThrow('spawn failed');
	});
});
