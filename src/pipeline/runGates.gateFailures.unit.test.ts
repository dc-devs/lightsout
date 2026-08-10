import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { gateLogCommand } from '@tests/helpers/gateLogCommand';
import { readGateLog } from '@tests/helpers/readGateLog';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { GateResult } from '@/contracts';
import { runGates } from '@/pipeline';

/** A gate that writes to stderr and exits red — the output the failure message must carry. */
const redGate = ({ exitCode, message }: { exitCode: number; message: string }) => `node -e "process.stderr.write('${message}'); process.exit(${exitCode})"`;

test('the build gate runs last in the root set, after check and the test run', async () => {
	const dir = setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			testUnit: `${gateLogCommand({ kind: 'testUnit' })} root`,
			build: `${gateLogCommand({ kind: 'build' })} root`,
		},
	});
	const config = await loadConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	expect(error).toBe(undefined);
	expect(readGateLog({ dir })).toStrictEqual(['root check', 'root testUnit', 'root build']);
});

test('a red build fails the set with its exit code and output', async () => {
	const dir = setupConsumerRepo({ scripts: { build: redGate({ exitCode: 3, message: 'compiler said no' }) } });
	const config = await loadConfig({ cwd: dir });

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
	const config = await loadConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	expect(error ?? '').toMatch(/generate failed \(exit 2\)/);
	expect(error ?? '').toMatch(/codegen broke/);
	// no gate ran after the red generate
	expect(readGateLog({ dir })).toStrictEqual([]);
});

test('a gate that cannot spawn is a red gate, not a crash — and is never re-run', async () => {
	const dir = setupConsumerRepo();
	const config = await loadConfig({ cwd: dir });
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
