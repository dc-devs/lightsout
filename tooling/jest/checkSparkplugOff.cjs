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

// Workers inherit the parent's Node flags, so checking the parent covers them.
module.exports = async () => {
	const message = getSparkplugOnMessage({ execArgv: process.execArgv });

	if (message !== undefined) {
		throw new Error(message);
	}
};
