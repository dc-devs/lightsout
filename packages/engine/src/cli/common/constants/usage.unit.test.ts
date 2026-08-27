import { expect, test } from '@jest/globals';
import { usage } from '#src/cli/index.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

// `usage` is no longer a hand-written block: it is what the command catalog's
// renderer returns, evaluated once when the module loads. Every CLI path that
// prints help — a missing required flag, an unknown command, `help` itself —
// prints this string, so the whole block is pinned against the same
// hand-written fixture the renderer is held to. A `usage.ts` that grew its own
// copy of the text, or lost a command the catalog carries, fails here.

test('usage: the text every CLI help path prints is the checked-in --help block, byte for byte', () => {
	expect(usage).toBe(usageFixture);
});
