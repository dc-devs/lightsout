import { afterEach, jest } from '@jest/globals';

// Captured before any test file loads (setupFilesAfterEnv runs first), so these
// are the pristine process values.
const realIsTty = process.stdout.isTTY;
const realPath = process.env.PATH;

// clearMocks/restoreMocks put every spy back, but these three are not mock state:
// isTTY is a plain property the render tests assign directly, PATH is what the
// harness-stubbing setups prepend a temp bin dir to, and fake timers are not
// mocks at all. Per the standards' Mock Cleanup section this belongs in config
// rather than in per-test hooks — every setup that dirties one of them sets it
// fresh, so restoring after each test is both safe and uniform.
//
// jest.replaceProperty is not an option for isTTY: it is not an own property of
// process.stdout when stdout is piped, which is every Jest worker.
afterEach(() => {
	jest.useRealTimers();
	process.stdout.isTTY = realIsTty;
	process.env.PATH = realPath;
});
