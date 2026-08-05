import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { improveCommand } from '@/cli/improveCommand';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

// improve resolves its config and driver BEFORE the friction check, and its
// config load is non-fatal only when no config file exists — both arrangements
// end at the empty-friction early return, so no harness binary is ever spawned.
const setupImprove = ({ t, args, config }: { t: TestContext; args: string[]; config?: Record<string, unknown> }) => {
	const captured = captureCommandOutput({ t });
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-improve-command-'));

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, ...captured };
};

test('improveCommand: without --engine it prints the usage text on stderr and exits 1 before touching the config', async (t) => {
	const { context, logged, errors, exitCodes } = setupImprove({ t, args: [] });

	await assert.rejects(improveCommand(context), /process\.exit/);

	assert.deepEqual(logged, []);
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.match(errors[0] ?? '', /lightsout improve --engine <lightsout-repo-path>/);
	assert.deepEqual(exitCodes, [1]);
});

test('improveCommand: an --engine flag given with no value is not a value — it fails the same way', async (t) => {
	const { context, errors, exitCodes } = setupImprove({ t, args: ['--engine'] });

	await assert.rejects(improveCommand(context), /process\.exit/);

	assert.equal(errors.length, 1);
	assert.deepEqual(exitCodes, [1]);
});

test('improveCommand: no recorded friction reports there is nothing to improve from and exits 0 without invoking a harness', async (t) => {
	const { context, logged, errors, exitCodes } = setupImprove({ t, args: ['--engine', '/does/not/need/to/exist'] });

	await assert.rejects(improveCommand(context), /process\.exit/);

	assert.deepEqual(logged, ['no friction recorded — nothing to improve from']);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('improveCommand: a present-but-invalid config is a hard error, not the missing-config fallback', async (t) => {
	const { context } = setupImprove({
		t,
		args: ['--engine', '/does/not/need/to/exist'],
		config: { driver: 'codex', scripts: { check: 'c', testUnit: 't', testCoverage: false } },
	});

	await assert.rejects(improveCommand(context), /renamed to `harness`/);
});
