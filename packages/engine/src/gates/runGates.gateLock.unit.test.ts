import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import { runGates } from '#src/gates/index.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The spawner is doubled, and every test but the last one reaches straight
// through it to real processes — the reservation's whole subject is what real
// detached gate commands put in the document, so faking them would test
// nothing. The last test needs the one shape a real spawn cannot be arranged
// into from outside: a command that never spawned, and so never reported a pid.
// Git is left real in that test too, because the shared-state folder the
// reservation lives in is resolved by asking git where the primary checkout is.
interface RunCommandParams {
	command: string;
	cwd: string;
	timeoutMs?: number;
	env?: Record<string, string>;
	/** The hook the reservation records a gate's process group through. A spawn that failed never calls it. */
	onSpawn?: ({ pid }: { pid: number }) => void;
}

const actual = jest.requireActual<typeof import('#src/common/processes/runCommand.ts')>('#src/common/processes/runCommand.ts');
const mockRunCommand = jest.fn<(params: RunCommandParams) => Promise<CommandResult> | undefined>();

jest.mock('#src/common/processes/runCommand.ts', () => ({
	runCommand: (params: RunCommandParams) => mockRunCommand(params) ?? actual.runCommand(params),
}));
// -------------------------

/** Where the shared reservation lands for a repo that is its own primary checkout. */
const gateLockPath = ({ dir }: { dir: string }) => join(dir, '.lightsout', 'gate-lock.json');

/**
 * The gate-group list the reservation carries right now, or undefined when
 * there is no reservation at all — the two must not read the same, or a test
 * that took no reservation would pass as one whose list stayed empty.
 */
const readReservedGroups = ({ dir }: { dir: string }): number[] | undefined => {
	const path = gateLockPath({ dir });

	return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { gateGroups: number[] }).gateGroups : undefined;
};

/** The reservation's gate-group list, as an expression a gate command can evaluate. */
const reservedGroupsExpression = `JSON.parse(require('fs').readFileSync('.lightsout/gate-lock.json','utf8')).gateGroups`;
/**
 * A gate command that waits, then appends the reservation's gate-group list to
 * groups.log — the reservation as the running gate itself sees it.
 *
 * The wait is what makes the snapshot meaningful: the group set is persisted
 * from the engine's side after the spawn returns, so a command that read the
 * document in its first millisecond would be racing the write rather than
 * observing it.
 */
const snapshotGroupsCommand = `node -e "setTimeout(()=>require('fs').appendFileSync('groups.log',JSON.stringify(${reservedGroupsExpression})+'\\n'),400)"`;

/** The gate-group lists the running gates recorded, one line per execution. */
const readGroupSnapshots = ({ dir }: { dir: string }): number[][] =>
	readFileSync(join(dir, 'groups.log'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as number[]);

/**
 * A consumer repo whose check and test gates run `command`, with the spawner
 * reset to reach real processes — the default an interception has to opt out of.
 */
const setupGateLockRepo = async ({ command }: { command?: string } = {}) => {
	mockRunCommand.mockReset();

	const scripts =
		command === undefined ? { check: gateLogCommand({ kind: 'check' }), test: gateLogCommand({ kind: 'test' }) } : { check: command, test: command };
	const dir = setupConsumerRepo({ scripts });

	return { dir, config: await readConfig({ cwd: dir }) };
};

/** The same repo, with the machine already reserved by a run whose pid is this very process — alive, so never reclaimable. */
const setupHeldMachine = async () => {
	const { dir, config } = await setupGateLockRepo();

	mkdirSync(join(dir, '.lightsout'), { recursive: true });
	writeFileSync(
		gateLockPath({ dir }),
		`${JSON.stringify({
			pid: process.pid,
			runId: 'holder-run-7',
			worktree: '/tmp/sibling-worktree',
			startedAt: new Date(Date.now() - 90_000).toISOString(),
			gateGroups: [],
		})}\n`,
	);

	return { dir, config };
};

/** The same repo, with every gate command failing to spawn — the one case that reports no pid at all. */
const setupUnspawnableGates = async () => {
	const { dir, config } = await setupGateLockRepo();
	const groupSnapshots: (number[] | undefined)[] = [];

	mockRunCommand.mockImplementation(({ command, cwd }) => {
		if (command.startsWith('git ')) {
			return undefined;
		}

		groupSnapshots.push(readReservedGroups({ dir: cwd }));

		return Promise.reject(new Error('spawn EAGAIN'));
	});

	return { dir, config, groupSnapshots };
};

describe('runGates', () => {
	test('takes no reservation and never waits when the schedule runs no stage', async () => {
		const { dir, config } = await setupGateLockRepo();
		const progress: string[] = [];

		const result = await runGates({ cwd: dir, config, schedule: { kind: GateScheduleKind.Off }, onProgress: (message) => progress.push(message) });

		expect(result).toStrictEqual({ error: undefined, failedFamilies: [], crashes: [], coordination: undefined });
		// nothing was reserved, so nothing had to be waited for or released
		expect(existsSync(gateLockPath({ dir }))).toBe(false);
		expect(progress).toStrictEqual([]);
		expect(readGateLog({ dir })).toStrictEqual([]);
	});

	test('answers a coordination reason beside error with no failed families, having run no gate command', async () => {
		const { dir, config } = await setupHeldMachine();
		const gateResults: GateResult[] = [];

		// A zero ceiling is the wait expiring on its first look: the ceiling the
		// settled decision fixes is thirty minutes, which no test can sit through.
		const result = await runGates({ cwd: dir, config, waitForMachine: false, onGateResult: (gate) => gateResults.push(gate) });

		expect(result.coordination).toEqual(expect.any(String));
		// the same sentence in both channels, so a caller reading only `error` still fails closed
		expect(result.error).toBe(result.coordination);
		// nothing here is evidence about the code, so no family and no crash is offered to a fix agent
		expect(result.failedFamilies).toStrictEqual([]);
		expect(result.crashes).toStrictEqual([]);
		// the reason names who is holding the machine
		expect(result.coordination ?? '').toMatch(/holder-run-7/);
		// not one gate command executed
		expect(gateResults).toStrictEqual([]);
		expect(readGateLog({ dir })).toStrictEqual([]);
		// the live holder's reservation is left exactly where it is — never bypassed, never reclaimed
		expect(JSON.parse(readFileSync(gateLockPath({ dir }), 'utf8'))).toEqual(expect.objectContaining({ runId: 'holder-run-7' }));
	});

	test("records each gate command's process group in the reservation while it runs and drops it on exit", async () => {
		const { dir, config } = await setupGateLockRepo({ command: snapshotGroupsCommand });

		const result = await runGates({ cwd: dir, config });
		const snapshots = readGroupSnapshots({ dir });

		expect(result.error).toBe(undefined);
		// each of the two gates saw exactly one group reserved while it ran
		expect(snapshots).toEqual([[expect.any(Number)], [expect.any(Number)]]);
		// and it was its own: the first gate's group had already been dropped when the second looked
		expect(snapshots[1]?.[0]).not.toBe(snapshots[0]?.[0]);
	});

	test('leaves the group list untouched when a gate command never spawned', async () => {
		const { dir, config, groupSnapshots } = await setupUnspawnableGates();

		const result = await runGates({ cwd: dir, config, failFast: false });

		// both gates were attempted, the reservation was held throughout, and neither
		// attempt put anything in the list the reclaim rule reads
		expect(groupSnapshots).toStrictEqual([[], []]);
		// a spawn that failed is an ordinary red gate, not a coordination failure
		expect(result.coordination).toBe(undefined);
		expect(result.failedFamilies).toStrictEqual(['check', 'test']);
		// and the reservation was still released
		expect(existsSync(gateLockPath({ dir }))).toBe(false);
	});
});
