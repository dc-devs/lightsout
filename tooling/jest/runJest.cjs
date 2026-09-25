/**
 * Starts Jest's own command line. Every test script in this workspace runs it
 * as `node --no-sparkplug …/runJest.cjs`, and `pnpm jest` does the same for a
 * one-off run.
 *
 * It exists because the flag has to reach `node` itself. V8's baseline compiler,
 * Sparkplug, can leave a bad slot on the stack that V8's garbage collector then
 * reads, and the Jest worker holding it dies with SIGSEGV
 * (https://github.com/nodejs/node/issues/62393). Its suite is reported as failed
 * although no test failed. `--no-sparkplug` turns that compiler off, at no
 * measurable cost to a run. Node refuses the flag in NODE_OPTIONS, and
 * `node_modules/.bin/jest` is a shell script that cannot pass it on, so a script
 * has to start `node` with the flag and load Jest from here. Jest starts each
 * worker with the same Node flags as this process, so the workers get it too.
 *
 * The flag can come out once the Node this repo runs on carries V8's fix and
 * repeated runs without the flag stop crashing. The fix is in V8 14.1 (Node
 * 25), but one report on that issue still sees the crash on Node 26.7.0, so a
 * version number alone does not settle it.
 *
 * checkSparkplugOff.cjs stops a run that was started any other way.
 */
require('jest/bin/jest');
