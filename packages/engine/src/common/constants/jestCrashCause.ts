/** The usual cause of a gate crash and its fix, shared by every message that reports one. */
export const jestCrashCause =
	"The usual cause is V8's garbage-collector crash (https://github.com/nodejs/node/issues/62393), which kills a Jest worker; starting Jest as `node --no-sparkplug node_modules/jest/bin/jest.js` avoids it.";
