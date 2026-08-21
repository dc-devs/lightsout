/**
 * The lowest Node this suite is known to survive, per major line.
 *
 * Not a style pin — a crash. On Node 24.11.0 a jest worker segfaults roughly
 * one full engine run in five, inside V8's mark-compact collector
 * (`ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers`, reached from
 * `MarkCompactCollector::MarkLiveObjects`). It surfaces as `Test suite failed
 * to run … terminated by another process: signal=SIGSEGV` against whichever
 * suite the dead worker happened to hold, so it reads like a broken test and is
 * not one. Finding that out costs about an hour, every time.
 *
 * Measured, not inferred: 24.11.0 reproduces with `--skip-nx-cache`, at
 * `--parallel=1`, and with one package's suite alone. 22.22.2 and 24.19.0 each
 * ran six clean rounds. Nothing between 24.11.0 and 24.19.0 has been tried, so
 * the 24 floor is the lowest version measured clean rather than the highest one
 * measured broken.
 *
 * A major line with no entry here runs: an unmeasured Node is untested, not
 * known-bad, and a table that blocked by default would stop a version upgrade
 * before anyone had a chance to measure it.
 */
const floors = { 22: '22.18.0', 24: '24.19.0' };

/** True when `version` is below `floor`, comparing numerically segment by segment. */
const isBelow = ({ version, floor }) => {
	const segments = (value) => value.split('.').map((segment) => Number.parseInt(segment, 10) || 0);
	const [left, right] = [segments(version), segments(floor)];

	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		if ((left[index] ?? 0) !== (right[index] ?? 0)) {
			return (left[index] ?? 0) < (right[index] ?? 0);
		}
	}

	return false;
};

/** Why this Node must not run the suite, or undefined when it may. */
const getUnsupportedNodeMessage = ({ version }) => {
	const floor = floors[version.split('.')[0]];

	return floor === undefined || !isBelow({ version, floor })
		? undefined
		: [
				'',
				`  Node ${version} is below ${floor}, the lowest ${version.split('.')[0]}.x this suite is known to survive.`,
				'',
				'  On Node 24.11.0 a jest worker segfaults inside V8 roughly one run in five,',
				'  and it is reported against whichever suite that worker held — a green test',
				'  failing for a reason that has nothing to do with it.',
				'',
				`    nvm use            (reads .nvmrc)`,
				'',
			].join('\n');
};

/**
 * Jest runs this once per project before any worker starts. Throwing here stops
 * the run outright, which is the point: the alternative is a crash reported as
 * a test failure somewhere unrelated.
 */
module.exports = async () => {
	const message = getUnsupportedNodeMessage({ version: process.versions.node });

	if (message !== undefined) {
		throw new Error(message);
	}
};

module.exports.getUnsupportedNodeMessage = getUnsupportedNodeMessage;
