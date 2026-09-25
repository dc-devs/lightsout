/** Why this process must not run the suite, or undefined when it may. */
const getSparkplugOnMessage = ({ execArgv }) =>
	execArgv.includes('--no-sparkplug')
		? undefined
		: [
				'',
				'  Jest was started without --no-sparkplug.',
				'',
				"  Without it, V8's baseline compiler can crash a Jest worker inside garbage",
				"  collection (nodejs/node#62393), and the dead worker's suite is reported as",
				'  failed although no test failed. Start Jest through a script that passes the flag:',
				'',
				'    pnpm test:unit',
				'    pnpm jest -c packages/<package>/jest.config.cjs <test path>',
				'',
			].join('\n');

/**
 * Jest runs this once per project before any worker starts, and the workers
 * inherit this process's Node flags, so checking here covers them too.
 * Throwing stops the run outright. Otherwise a run started as plain `jest`
 * would lose a suite to the crash some of the time, reported as a test failure
 * somewhere unrelated. runJest.cjs holds the evidence and says when the flag
 * can come out.
 */
module.exports = async () => {
	const message = getSparkplugOnMessage({ execArgv: process.execArgv });

	if (message !== undefined) {
		throw new Error(message);
	}
};
