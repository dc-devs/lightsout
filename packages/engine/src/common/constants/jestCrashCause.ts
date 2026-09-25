/**
 * What a gate that crashed instead of failing most likely hit, and how a
 * repository stops it.
 *
 * V8's baseline compiler, Sparkplug, can leave a bad slot on the stack that
 * V8's garbage collector then reads, and the Jest worker holding it dies with
 * SIGSEGV. Node refuses `--no-sparkplug` in NODE_OPTIONS, and
 * `node_modules/.bin/jest` is a shell script that cannot pass it on, so the
 * command has to start `node` itself; Jest's workers inherit the flag.
 *
 * One sentence because three messages name it — the gate runner's friction
 * entry, a verification step's stop, and a ship blocked on the integrated
 * branch — and an operator should read the same cause and the same fix in each.
 */
export const jestCrashCause =
	"The usual cause is V8's garbage-collector crash (https://github.com/nodejs/node/issues/62393), which kills a Jest worker; starting Jest as `node --no-sparkplug node_modules/jest/bin/jest.js` avoids it.";
