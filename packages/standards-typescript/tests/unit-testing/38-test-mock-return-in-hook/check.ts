import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildHookContentCheck } from '../../../common/utils/buildHookContentCheck.ts';

/** The four return-value setters the rule names. The `*Once` variants are deliberately absent — the prose does not name them. */
const returnSetter = /\.mock(?:ReturnValue|ResolvedValue|RejectedValue|Implementation)\s*\(/;

// `beforeEach` only, the single hook the rule names — and the sanctioned home
// for a return value is the `setup()` factory, which is not a hook at all.
export const check: StandardsCheckModule = buildHookContentCheck({
	rule: 'test-mock-return-in-hook',
	hooks: ['beforeEach'],
	pattern: returnSetter,
	detailSuffix: 'sets a mock return value',
	guidance: 'Set mock return values in the `setup()` factory, so each test states its own arrangement.',
});
