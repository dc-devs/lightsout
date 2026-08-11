import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildHookContentCheck } from '../../../common/utils/buildHookContentCheck.ts';

/** An assertion. */
const assertion = /\bexpect\s*\(/;

// `beforeEach` only, the single hook the rule names — an `expect` in an
// `afterEach` is an ordinary leak check the prose never bans.
export const check: StandardsCheckModule = buildHookContentCheck({
	rule: 'test-assert-in-hook',
	hooks: ['beforeEach'],
	pattern: assertion,
	detailSuffix: 'asserts',
	guidance: 'Act and assert live in the `test`; a hook only arranges.',
});
