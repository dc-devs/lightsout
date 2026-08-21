import { expect, test } from '@jest/globals';
import { extractRunScriptName } from '#src/common/config/extractRunScriptName.ts';

test.each([
	{ command: 'pnpm --filter @acme/api run check', expected: 'check' },
	{ command: 'pnpm run --if-present test:unit', expected: 'test:unit' },
	{ command: 'turbo run check --filter=@acme/api', expected: 'check' },
	{ command: 'npm run test:unit:coverage --workspace=@acme/api', expected: 'test:unit:coverage' },
])('extractRunScriptName: `$command` names the script $expected, stepping over flags', ({ command, expected }) => {
	const script = extractRunScriptName({ command });

	expect(script).toBe(expected);
});

test.each([
	{ case: 'no run token at all', command: 'pnpm --filter @acme/api test' },
	{ case: 'nothing after the run token', command: 'pnpm --filter @acme/api run' },
	{ case: 'run as a substring of a longer token', command: 'pnpm runner check' },
	{ case: 'run as the tail of a longer token', command: 'pnpm prerun check' },
	// the empty token a trailing space produces is never the script name
	{ case: 'a trailing space', command: 'pnpm run ' },
	{ case: 'a flags-only tail', command: 'npm run -- --silent' },
])('extractRunScriptName: $case reads as unknown, not as a script', ({ command }) => {
	const script = extractRunScriptName({ command });

	expect(script).toBe(undefined);
});
