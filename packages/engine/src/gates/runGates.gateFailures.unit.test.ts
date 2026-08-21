import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { runGates } from '#src/gates/index.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** A gate that writes to stderr and exits red — the output the failure message must carry. */
const redGate = ({ exitCode, message }: { exitCode: number; message: string }) => `node -e "process.stderr.write('${message}'); process.exit(${exitCode})"`;

/** A monorepo consumer with one real package under `packages/`, so a scope naming any other directory has nothing to resolve. */
const setupScopedRepo = () => {
	const dir = setupConsumerRepo({
		config: {
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package}`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
			},
		},
	});

	mkdirSync(join(dir, 'packages', 'api'), { recursive: true });
	writeFileSync(join(dir, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api' }));

	return dir;
};

test('the build gate runs last in the root set, after check and the test run', async () => {
	const dir = setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			test: `${gateLogCommand({ kind: 'test' })} root`,
			build: `${gateLogCommand({ kind: 'build' })} root`,
		},
	});
	const config = await readConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	expect(error).toBe(undefined);
	expect(readGateLog({ dir })).toStrictEqual(['root check', 'root test', 'root build']);
});

test('a red build fails the set with its exit code and output', async () => {
	const dir = setupConsumerRepo({ scripts: { build: redGate({ exitCode: 3, message: 'compiler said no' }) } });
	const config = await readConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	expect(error ?? '').toMatch(/build failed \(exit 3\)/);
	expect(error ?? '').toMatch(/compiler said no/);
});

test('a red generate short-circuits the gate set — no gate runs behind broken codegen', async () => {
	const dir = setupConsumerRepo({
		scripts: {
			generate: redGate({ exitCode: 2, message: 'codegen broke' }),
			check: `${gateLogCommand({ kind: 'check' })} root`,
		},
	});
	const config = await readConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	expect(error ?? '').toMatch(/generate failed \(exit 2\)/);
	expect(error ?? '').toMatch(/codegen broke/);
	// no gate ran after the red generate
	expect(readGateLog({ dir })).toStrictEqual([]);
});

test('a gate that cannot spawn is a red gate, not a crash — and is never re-run', async () => {
	const dir = setupConsumerRepo();
	const config = await readConfig({ cwd: dir });
	const results: GateResult[] = [];

	const error = await runGates({ cwd: join(dir, 'no-such-dir'), config, onGateResult: (result) => results.push(result) });

	expect(error ?? '').toMatch(/check failed \(exit -1\)/);
	expect(error ?? '').toMatch(/ENOENT/);

	const checks = results.filter((result) => result.kind === 'check');

	// a synthetic -1 buys no flake re-run
	expect(checks.length).toBe(1);
	expect(checks[0]?.exitCode).toBe(-1);
	expect(checks[0]?.rerun).toBe(undefined);
	// the spawn error is the red gate’s evidence
	expect(checks[0]?.outputTail ?? '').toMatch(/ENOENT/);
});

test('a package whose manifest cannot be resolved fails its own group only — the rest of the fan-out still runs', async () => {
	const dir = setupScopedRepo();
	const config = await readConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config, packages: ['api', 'ghost'] });

	// the engine never guesses a workspace filter, so an unresolvable package is
	// a failure string rather than a thrown error that would take the whole
	// parallel fan-out down with it
	expect(error ?? '').toMatch(/declared package 'ghost' has no package.json/);
	// the healthy package's gates ran to completion beside the broken one
	expect(readGateLog({ dir })).toStrictEqual(['@acme/api check', '@acme/api test']);
});
