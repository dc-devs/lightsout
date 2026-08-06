import { expect, test } from '@jest/globals';
import { extractRunScriptName } from '@/common/utils/extractRunScriptName';

test('extractRunScriptName reads the script after a run token, stepping over flags', () => {
	expect(extractRunScriptName({ command: 'pnpm --filter @acme/api run check' })).toBe('check');
	expect(extractRunScriptName({ command: 'pnpm run --if-present test:unit' })).toBe('test:unit');
	expect(extractRunScriptName({ command: 'turbo run check --filter=@acme/api' })).toBe('check');
	expect(extractRunScriptName({ command: 'npm run test:unit:coverage --workspace=@acme/api' })).toBe('test:unit:coverage');
	expect(extractRunScriptName({ command: 'pnpm --filter @acme/api test' })).toBe(undefined);
	expect(extractRunScriptName({ command: 'pnpm --filter @acme/api run' })).toBe(undefined);
});

test('extractRunScriptName: run must be a standalone token, never a substring of one', () => {
	expect(extractRunScriptName({ command: 'pnpm runner check' })).toBe(undefined);
	expect(extractRunScriptName({ command: 'pnpm prerun check' })).toBe(undefined);
});

test('extractRunScriptName: a trailing space or flags-only tail reads as unknown, not as a script', () => {
	// the empty token a trailing space produces is never the script name
	expect(extractRunScriptName({ command: 'pnpm run ' })).toBe(undefined);
	expect(extractRunScriptName({ command: 'npm run -- --silent' })).toBe(undefined);
});
