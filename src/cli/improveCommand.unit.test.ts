import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { improveCommand } from '@/cli/improveCommand';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

// improve resolves its config and driver BEFORE the friction check, and its
// config load is non-fatal only when no config file exists — both arrangements
// end at the empty-friction early return, so no harness binary is ever spawned.
const setupImprove = ({ args, config }: { args: string[]; config?: Record<string, unknown> }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-improve-command-'));

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, ...captured };
};

test('improveCommand: without --engine it prints the usage text on stderr and exits 1 before touching the config', async () => {
	const { context, logged, errors, exitCodes } = setupImprove({ args: [] });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors.length).toBe(1);
	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(errors[0] ?? '').toMatch(/lightsout improve --engine <lightsout-repo-path>/);
	expect(exitCodes).toStrictEqual([1]);
});

test('improveCommand: an --engine flag given with no value is not a value — it fails the same way', async () => {
	const { context, errors, exitCodes } = setupImprove({ args: ['--engine'] });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors.length).toBe(1);
	expect(exitCodes).toStrictEqual([1]);
});

test('improveCommand: no recorded friction reports there is nothing to improve from and exits 0 without invoking a harness', async () => {
	const { context, logged, errors, exitCodes } = setupImprove({ args: ['--engine', '/does/not/need/to/exist'] });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual(['no friction recorded — nothing to improve from']);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('improveCommand: a present-but-invalid config is a hard error, not the missing-config fallback', async () => {
	const { context } = setupImprove({
		
		args: ['--engine', '/does/not/need/to/exist'],
		config: { driver: 'codex', scripts: { check: 'c', testUnit: 't', testCoverage: false } },
	});

	await expect(improveCommand(context)).rejects.toThrow(/renamed to `harness`/);
});
