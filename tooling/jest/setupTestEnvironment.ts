import { join } from 'node:path';
import { afterEach, jest } from '@jest/globals';

// Point the engine at the AUTHORED standards package rather than the committed
// build copy under plugin/. The engine's own walk can only find the copy, so
// without this every test touching the default would pass or fail on whether
// someone had last run `pnpm bundle` — a suite that is green because an artifact
// is stale is worse than one that is red.
//
// Set on process.env rather than passed in, because the e2e suites reach the
// engine as a spawned subprocess, which inherits the environment and nothing
// else. The one test that exercises the walk itself has to clear this.
process.env.LIGHTSOUT_DEFAULT_STANDARDS = join(__dirname, '..', '..', 'packages', 'standards-typescript');

// A queue worker exports LIGHTSOUT_NO_SHIP=1, and every gate command it runs —
// this suite included — inherits it. The variable silently beats both --ship
// and the config, so a test expecting a ship would pass on a developer's
// machine and fail inside the queue. Every test starts without it; a test about
// the suppression itself sets it where it needs it.
delete process.env.LIGHTSOUT_NO_SHIP;

// Captured before any test file loads (setupFilesAfterEnv runs first), so these
// are the pristine process values.
const realIsTty = process.stdout.isTTY;
const realPath = process.env.PATH;

// clearMocks/restoreMocks put every spy back, but these four are not mock state:
// isTTY is a plain property the render tests assign directly, PATH is what the
// harness-stubbing setups prepend a temp bin dir to, LIGHTSOUT_NO_SHIP is what
// the queue command sets on its own process, and fake timers are not mocks at
// all. Per the standards' Mock Cleanup section this belongs in config
// rather than in per-test hooks — every setup that dirties one of them sets it
// fresh, so restoring after each test is both safe and uniform.
//
// jest.replaceProperty is not an option for isTTY: it is not an own property of
// process.stdout when stdout is piped, which is every Jest worker.
afterEach(() => {
	jest.useRealTimers();
	process.stdout.isTTY = realIsTty;
	process.env.PATH = realPath;
	delete process.env.LIGHTSOUT_NO_SHIP;
});
