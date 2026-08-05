import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GateResult } from '@/contracts';
import { loadConfig } from '@/common/utils/loadConfig';
import { runGates } from '@/pipeline';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { gateLogCommand } from '@tests/helpers/gateLogCommand';
import { readGateLog } from '@tests/helpers/readGateLog';

/** A gate that writes to stderr and exits red — the output the failure message must carry. */
const redGate = ({ exitCode, message }: { exitCode: number; message: string }) =>
	`node -e "process.stderr.write('${message}'); process.exit(${exitCode})"`;

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

	assert.equal(error, undefined);
	assert.deepEqual(readGateLog({ dir }), ['root check', 'root testUnit', 'root build']);
});

test('a red build fails the set with its exit code and output', async () => {
	const dir = setupConsumerRepo({ scripts: { build: redGate({ exitCode: 3, message: 'compiler said no' }) } });
	const config = await loadConfig({ cwd: dir });

	const error = await runGates({ cwd: dir, config });

	assert.match(error ?? '', /build failed \(exit 3\)/);
	assert.match(error ?? '', /compiler said no/);
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

	assert.match(error ?? '', /generate failed \(exit 2\)/);
	assert.match(error ?? '', /codegen broke/);
	assert.deepEqual(readGateLog({ dir }), [], 'no gate ran after the red generate');
});

test('a gate that cannot spawn is a red gate, not a crash — and is never re-run', async () => {
	const dir = setupConsumerRepo();
	const config = await loadConfig({ cwd: dir });
	const results: GateResult[] = [];

	const error = await runGates({ cwd: join(dir, 'no-such-dir'), config, onGateResult: (result) => results.push(result) });

	assert.match(error ?? '', /check failed \(exit -1\)/);
	assert.match(error ?? '', /ENOENT/);

	const checks = results.filter((result) => result.kind === 'check');

	assert.equal(checks.length, 1, 'a synthetic -1 buys no flake re-run');
	assert.equal(checks[0]?.exitCode, -1);
	assert.equal(checks[0]?.rerun, undefined);
	assert.match(checks[0]?.outputTail ?? '', /ENOENT/, 'the spawn error is the red gate’s evidence');
});
