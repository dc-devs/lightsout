import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { GateEnding } from '#src/gates/common/constants/GateEnding.ts';

const jestWorkerSigsegv = /A jest worker process \(pid=\d+\) was terminated by another process: signal=SIGSEGV, exitCode=null\./;

// Jest's own tally line: `Tests:  1 failed, 5 passed, 6 total`. `Test Suites:`
// is a different line and does not match — the crashed suite is always counted
// failed there, so reading it would call every crash a real failure.
const reportedTestFailure = /\bTests:[ \t]+[^\n]*\d+ failed/;

/**
 * Gate kinds whose command is a test runner.
 *
 * Only these are judged by whether they tallied a failing test, because only
 * these produce such a tally: `check` and `build` never print one, so the same
 * reasoning would call every lint error a crash.
 */
const testKinds = new Set(['test', 'testCoverage', 'extraTests']);

// Jest's suite line, which it prints whenever it got far enough to report at
// all. Its presence is what says the runner ran; a test command that failed
// without it is some other tool failing for some other reason, and is ordinary
// evidence rather than a death.
const jestReported = /\bTest Suites:[ \t]+/;

/**
 * A red that is a dead test runner rather than evidence about the code.
 *
 * Two shapes, both seen on 2026-09-04 in one twenty-run sample. In the first
 * the worker dies and Jest survives to say so, which is the SIGSEGV line above.
 * In the second Jest itself goes down: the package prints its banner and then
 * nothing — no summary, no error, no signal named — and the run goes red having
 * never tallied a failing test. The first was already absorbed; the second was
 * reported as a broken suite and escalated the run.
 *
 * So the rule is the tally rather than the signature: a test gate that went red
 * without a single failing test did not fail, it died. A run that DOES tally a
 * failure is never this — that failure is real evidence about the code, and
 * absorbing the red would hide it.
 *
 * A test command that failed without Jest reporting at all is left alone: that
 * is some other tool failing for some other reason, and its output is ordinary
 * evidence.
 *
 * The known cost: a test file too broken to run — a syntax error, a bad import —
 * makes Jest report a failed suite while tallying no failed test, so it is
 * re-run before it is believed. That spends two extra gate runs on a real
 * breakage, against escalating an entire run on a crash that was never about
 * the code.
 */
const isWorkerCrash = ({ kind, result }: { kind: string; result: CommandResult }) => {
	const output = `${result.stdout}\n${result.stderr}`;

	// exit -1 is the runner's own spawn failure, which carries no gate output to
	// judge.
	if (result.exitCode === -1 || reportedTestFailure.test(output)) {
		return false;
	}

	return jestWorkerSigsegv.test(output) || (testKinds.has(kind) && jestReported.test(output));
};

interface Params {
	kind: string;
	result: CommandResult;
	/** True when this attempt's kill deadline fired — `runCommand`'s `onTimeout` was called. */
	timedOut: boolean;
}

/**
 * Which ending one gate attempt had — the runner's one judgment about it.
 *
 * The fired deadline is checked first because it is a fact rather than a
 * reading of output: a timed-out attempt carries only the runner's own error
 * text. A gate that failed to spawn has no deadline behind it, so it stays an
 * ordinary red.
 */
export const classifyGateEnding = ({ kind, result, timedOut }: Params): GateEnding => {
	let ending: GateEnding = GateEnding.Failed;

	if (timedOut) {
		ending = GateEnding.Timeout;
	} else if (result.exitCode === 0) {
		ending = GateEnding.Passed;
	} else if (isWorkerCrash({ kind, result })) {
		ending = GateEnding.Crashed;
	}

	return ending;
};
