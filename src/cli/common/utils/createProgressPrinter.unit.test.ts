import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';

// The stamp is elapsed wall time since the printer was created, so the clock is
// the arrangement: the mocked Date starts every printer at zero. The printed
// line is the whole output, so console.log is captured too.
const captureClockAndOutput = ({ t }: { t: TestContext }) => {
	const logged: string[] = [];

	t.mock.method(console, 'log', (...args: unknown[]) => {
		logged.push(String(args[0]));
	});
	t.mock.timers.enable({ apis: ['Date'], now: 0 });

	return { logged };
};

// The tick fixes exactly how long the run has been going when the message is
// printed; `laterPrinter` hands back one created after the tick instead.
const setupProgressPrinter = ({ t, elapsedMs = 0, laterPrinter = false }: { t: TestContext; elapsedMs?: number; laterPrinter?: boolean }) => {
	const { logged } = captureClockAndOutput({ t });
	const printer = createProgressPrinter();

	t.mock.timers.tick(elapsedMs);

	return { printer: laterPrinter ? createProgressPrinter() : printer, logged };
};

// A printer that has already spoken once: the second stamp must be read off the
// clock again, not reused from the first message.
const setupPrinterAfterFirstMessage = ({ t }: { t: TestContext }) => {
	const { logged } = captureClockAndOutput({ t });
	const printer = createProgressPrinter();

	t.mock.timers.tick(5_000);
	printer('first');
	t.mock.timers.tick(60_000);

	return { printer, logged };
};

for (const { elapsedMs, expected } of [
	{ elapsedMs: 0, expected: '[+0:00] scanning' },
	{ elapsedMs: 5_000, expected: '[+0:05] scanning' },
	{ elapsedMs: 59_000, expected: '[+0:59] scanning' },
	{ elapsedMs: 60_000, expected: '[+1:00] scanning' },
	{ elapsedMs: 65_000, expected: '[+1:05] scanning' },
	{ elapsedMs: 3_600_000, expected: '[+60:00] scanning' },
	{ elapsedMs: 3_725_000, expected: '[+62:05] scanning' },
]) {
	test(`createProgressPrinter: ${elapsedMs}ms into the run prints ${expected}`, (t) => {
		const { printer, logged } = setupProgressPrinter({ t, elapsedMs });

		printer('scanning');

		assert.deepEqual(logged, [expected]);
	});
}

test('createProgressPrinter: a sub-second remainder rounds to the nearest second and can roll the minute over', (t) => {
	const { printer, logged } = setupProgressPrinter({ t, elapsedMs: 59_600 });

	printer('scanning');

	assert.deepEqual(logged, ['[+1:00] scanning']);
});

test('createProgressPrinter: a remainder below half a second rounds down', (t) => {
	const { printer, logged } = setupProgressPrinter({ t, elapsedMs: 1_400 });

	printer('scanning');

	assert.deepEqual(logged, ['[+0:01] scanning']);
});

test('createProgressPrinter: each printer counts from its own creation, so one made mid-run starts back at zero', (t) => {
	const { printer, logged } = setupProgressPrinter({ t, elapsedMs: 60_000, laterPrinter: true });

	printer('scanning');

	assert.deepEqual(logged, ['[+0:00] scanning']);
});

test('createProgressPrinter: the stamp is read off the clock at every call, not fixed by the first message', (t) => {
	const { printer, logged } = setupPrinterAfterFirstMessage({ t });

	printer('second');

	assert.deepEqual(logged, ['[+0:05] first', '[+1:05] second']);
});

test('createProgressPrinter: the message is printed verbatim after the stamp, whatever it contains', (t) => {
	const { printer, logged } = setupProgressPrinter({ t, elapsedMs: 12_000 });

	printer('gate check failed: [pnpm check] — exit 1');

	assert.deepEqual(logged, ['[+0:12] gate check failed: [pnpm check] — exit 1']);
});
