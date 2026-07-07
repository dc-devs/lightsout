import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractRunScriptName } from './extractRunScriptName';

test('extractRunScriptName reads the script after a run token, stepping over flags', () => {
	assert.equal(extractRunScriptName({ command: 'pnpm --filter @acme/api run check' }), 'check');
	assert.equal(extractRunScriptName({ command: 'pnpm run --if-present test:unit' }), 'test:unit');
	assert.equal(extractRunScriptName({ command: 'turbo run check --filter=@acme/api' }), 'check');
	assert.equal(extractRunScriptName({ command: 'npm run test:unit:coverage --workspace=@acme/api' }), 'test:unit:coverage');
	assert.equal(extractRunScriptName({ command: 'pnpm --filter @acme/api test' }), undefined);
	assert.equal(extractRunScriptName({ command: 'pnpm --filter @acme/api run' }), undefined);
});
