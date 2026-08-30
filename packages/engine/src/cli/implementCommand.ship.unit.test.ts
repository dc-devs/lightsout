import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** The plan folder the phased case points `--plan` at. */
const planFolder = 'plans/demo';

/**
 * A real consumer repo whose `--plan` names a file that is not there: the
 * pipeline mints the run, then fails at the plan read, so the manifest the
 * command stamped is on disk and nothing spawned a harness to write over it.
 *
 * `phases` seeds the folder with a two-phase overview and `locked` plants a
 * live run lock, which together stop a phased sequence at its first phase —
 * leaving the coordinator's manifest as the only one written.
 */
const setupImplementShip = ({ args, config, phases, locked }: { args: string[]; config?: Record<string, unknown>; phases?: number; locked?: boolean }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config });

	// LIGHTSOUT_NO_SHIP silently beats both the flag and the config, and the
	// session running this suite may well have it exported — a queue worker sets
	// it for exactly that reason. Pinned empty so each case reads the flags it
	// typed. restoreMocks puts the real environment back after every test.
	jest.replaceProperty(process, 'env', { ...process.env, LIGHTSOUT_NO_SHIP: '' });

	if (phases !== undefined) {
		const rows = Array.from({ length: phases }, (_, index) => `| ${index + 1} | \`phase${index + 1}.md\` | scope |`);

		const overview = `# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n${rows.join('\n')}\n`;

		mkdirSync(join(cwd, planFolder), { recursive: true });
		writeFileSync(join(cwd, planFolder, 'overview.md'), overview);

		for (let phase = 1; phase <= phases; phase += 1) {
			writeFileSync(join(cwd, planFolder, `phase${phase}.md`), `# Feature — Phase ${phase}\n`);
		}
	}

	if (locked) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/** Every manifest the command left on disk — the record the progress view later draws its ship row from. */
const readManifests = ({ cwd }: { cwd: string }): { runId: string; pipeline?: string; willShip?: boolean }[] => {
	const runsDir = join(cwd, '.lightsout', 'runs');

	if (!existsSync(runsDir)) {
		return [];
	}

	return readdirSync(runsDir).map((runId) => JSON.parse(readFileSync(join(runsDir, runId, 'manifest.json'), 'utf8')));
};

describe('implementCommand ship intent', () => {
	test('refuses --ship and --no-ship together before the run starts, rather than after the whole run has gone by', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupImplementShip({ args: ['--plan', 'ghost.md', '--ship', '--no-ship'] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['--ship and --no-ship contradict each other — pass at most one']);
		// no banner and no run on disk: the refusal lands before anything starts
		expect(logged).toStrictEqual([]);
		expect(readManifests({ cwd })).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test.each([
		{ label: '--ship was typed', args: ['--ship'], config: undefined, willShip: true },
		{ label: 'nobody asked at all', args: [] as string[], config: undefined, willShip: false },
		{ label: 'the config says after-implement', args: [] as string[], config: { ship: { 'after-implement': true } }, willShip: true },
		{ label: '--no-ship beats the config', args: ['--no-ship'], config: { ship: { 'after-implement': true } }, willShip: false },
		{ label: '--ship outlives a ticket pattern nothing can compile', args: ['--ship'], config: { ship: { 'ticket-pattern': '^(?<broken>' } }, willShip: true },
	])('records on the manifest that $label, so a reader is shown the ship row before the ship happens', async ({ args, config, willShip }) => {
		const { context, cwd } = setupImplementShip({ args: ['--plan', 'ghost.md', ...args], config });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(readManifests({ cwd })).toEqual([expect.objectContaining({ willShip })]);
	});

	test('stamps a phased run’s intent on the coordinator, the one run of the sequence that can do the shipping', async () => {
		const { context, cwd } = setupImplementShip({ args: ['--plan', planFolder, '--ship'], phases: 2, locked: true });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		// the planted lock stops the first phase's own run before it mints one, so
		// the coordinator is the only manifest here — a phase child must never
		// carry a stamp it could not fill
		expect(readManifests({ cwd })).toEqual([expect.objectContaining({ pipeline: 'phases', willShip: true })]);
	});
});
