import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type DecisionsRecord, Effort, Permissions, type PlanFacts, PlanVariant } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { authorPhaseFiles, type PhaseDeclaration } from '#src/plan/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';

/** The verified facts every phase spawn is handed — content is irrelevant here, only that it rides each invocation. */
const facts: PlanFacts = {
	request: 'do a thing',
	areas: [],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-01-01T00:00:00.000Z',
};

const decisions: DecisionsRecord = { planName: 'demo', decisions: [] };

/** One overview row, defaulted to a phase that declares nothing across its boundary. */
const declarationFor = ({ number, ...overrides }: Partial<PhaseDeclaration> & { number: number }): PhaseDeclaration => ({
	number,
	file: `phase${number}-step.md`,
	scope: 'the work',
	createdCount: 1,
	touchedCount: 1,
	creates: [],
	exports: [],
	scripts: [],
	...overrides,
});

/** What one phase spawn answers, chosen by the phase file its prompt names. */
type Respond = (params: { file: string; path: string }) => { text: string; exitCode: number; rateLimited?: boolean } | undefined;

/** The plan-writer's drafted report for one phase file. */
const draftedReport = ({ path }: { path: string }) =>
	JSON.stringify({
		status: 'drafted',
		filesWritten: [{ path, variant: PlanVariant.Phase, scope: basename(path) }],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: [],
	});

/**
 * A phase-writer stub: it authors the one file the engine dictated in its prompt
 * and reports it, unless `respond` scripts a different answer for that phase.
 */
const phaseDriver = ({ respond, onInvoke }: { respond?: Respond; onInvoke?: (invocation: DriverInvocation) => void } = {}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		onInvoke?.(invocation);

		const path = /- (\S+\.md) — variant:/.exec(invocation.prompt)?.[1];

		// the engine dictates exactly one output path per phase spawn
		expectDefined(path);

		const scripted = respond?.({ file: basename(path), path });

		if (scripted) {
			return scripted;
		}

		writeFileSync(path, `# ${basename(path)}\n`);

		return { text: draftedReport({ path }), exitCode: 0 };
	},
});

/** A plan workspace on disk plus the arguments the fan-out takes, ready for one act. */
const setupFanOut = ({ count, driver }: { count: number; driver: Driver }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-phases-'));
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(workspaceDir, { recursive: true });

	const messages: string[] = [];
	const declarations = Array.from({ length: count }, (_, index) => declarationFor({ number: index + 1 }));

	return {
		cwd,
		workspaceDir,
		declarations,
		messages,
		params: {
			cwd,
			driver,
			name: 'demo',
			workspaceDir,
			facts,
			decisions,
			overviewText: '# Demo — Overview\n',
			declarations,
			executorFileLimit: 50,
			timeoutMs: 60_000,
			progress: (message: string) => messages.push(message),
		},
	};
};

describe('authorPhaseFiles', () => {
	test('one spawn per declared phase writes one file each, returned in phase order with a report apiece', async () => {
		const invocations: DriverInvocation[] = [];
		const { cwd, params } = setupFanOut({ count: 3, driver: phaseDriver({ onInvoke: (invocation) => invocations.push(invocation) }) });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'complete');
		// the declaration is what buys the concurrency: three agents, three files,
		// none of them reading another's unfinished text
		expect({ spawns: invocations.length, planPaths: result.planPaths, reports: result.reports.length }).toStrictEqual({
			spawns: 3,
			planPaths: [1, 2, 3].map((number) => join(cwd, '.lightsout', 'plans', 'demo', `phase${number}-step.md`)),
			reports: 3,
		});
	});

	test('each phase spawn is handed its own declaration and its predecessor’s, and phase 1 is told it has none', async () => {
		const prompts: string[] = [];
		const { params } = setupFanOut({ count: 2, driver: phaseDriver({ onInvoke: ({ prompt }) => prompts.push(prompt) }) });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'complete');

		const second = prompts.find((prompt) => prompt.includes('phase2-step.md — variant:'));

		expectDefined(second);
		// both sides of the hand-off are derived from the same two rows, which is
		// what makes concurrent agents spell the boundary identically
		expect(prompts[0]).toContain('This is phase 1 — there is no previous phase.');
		expect(second).toContain("The previous phase's declaration");
		expect(second).toContain('"file": "phase1-step.md"');
	});

	test('no phase spawn is handed a self-lint command or a command grant', async () => {
		const invocations: DriverInvocation[] = [];
		const { params } = setupFanOut({ count: 2, driver: phaseDriver({ onInvoke: (invocation) => invocations.push(invocation) }) });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'complete');
		// its siblings are not on disk yet, so a lint there reports artefacts of
		// when it looked rather than defects
		expect(invocations.map(({ prompt, allowedCommands }) => ({ selfLint: prompt.includes('## Self-lint'), allowedCommands }))).toStrictEqual([
			{ selfLint: false, allowedCommands: undefined },
			{ selfLint: false, allowedCommands: undefined },
		]);
	});

	test('the caller’s model, effort, permissions and timeout ride every phase spawn alike', async () => {
		const invocations: DriverInvocation[] = [];
		const { params } = setupFanOut({ count: 2, driver: phaseDriver({ onInvoke: (invocation) => invocations.push(invocation) }) });

		const result = await authorPhaseFiles({ ...params, model: 'test-model', effort: Effort.High, permissions: Permissions.FullAccess });

		expectStatus(result, 'complete');
		// a phase spawn is a plan writer like any other — it never runs at a
		// quieter capability level just because it is one of many
		expect(invocations.map(({ model, effort, permissions, timeoutMs }) => ({ model, effort, permissions, timeoutMs }))).toStrictEqual([
			{ model: 'test-model', effort: 'high', permissions: 'full-access', timeoutMs: 60_000 },
			{ model: 'test-model', effort: 'high', permissions: 'full-access', timeoutMs: 60_000 },
		]);
	});

	test('a rate-limited phase parks the whole draft and stops feeding the wall', async () => {
		let spawns = 0;
		const driver = phaseDriver({
			onInvoke: () => (spawns += 1),
			respond: ({ file }) => (file === 'phase1-step.md' ? { text: '', exitCode: 1, rateLimited: true } : undefined),
		});
		const { params } = setupFanOut({ count: 12, driver });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'paused-rate-limit');
		// the eight opening slots are already claimed and finish, but a wall met
		// by launching another four spawns into it is still a wall
		expect({ spawns, parked: /rate limit/.test(result.error) }).toStrictEqual({ spawns: 8, parked: true });
		expect(result.error).toContain('lightsout plan draft --name demo');
	});

	test('a phase reporting a facts discrepancy returns facts-error with each one labelled by its phase file', async () => {
		const driver = phaseDriver({
			respond: ({ file }) =>
				file === 'phase2-step.md'
					? {
							text: JSON.stringify({
								status: 'error',
								filesWritten: [],
								decisionsApplied: 0,
								assumptions: [],
								discrepancies: ['facts reference src/ghost.ts — does not exist'],
							}),
							exitCode: 0,
						}
					: undefined,
		});
		const { params } = setupFanOut({ count: 3, driver });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'facts-error');
		// which phase found it is the first thing a human needs
		expect(result.discrepancies).toStrictEqual(['phase2-step.md: facts reference src/ghost.ts — does not exist']);
	});

	test('discrepancies from several phases all come back — one bad phase never hides another', async () => {
		const driver = phaseDriver({
			respond: ({ file }) => ({
				text: JSON.stringify({
					status: 'error',
					filesWritten: [],
					decisionsApplied: 0,
					assumptions: [],
					discrepancies: [`${file} disagrees with the facts`],
				}),
				exitCode: 0,
			}),
		});
		const { params } = setupFanOut({ count: 3, driver });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'facts-error');
		expect(result.discrepancies).toStrictEqual([
			'phase1-step.md: phase1-step.md disagrees with the facts',
			'phase2-step.md: phase2-step.md disagrees with the facts',
			'phase3-step.md: phase3-step.md disagrees with the facts',
		]);
	});

	test('failed phase spawns accumulate with the file that produced each, rather than short-circuiting', async () => {
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				const path = /- (\S+\.md) — variant:/.exec(prompt)?.[1] ?? '';

				if (basename(path) === 'phase2-step.md') {
					writeFileSync(path, '# phase2\n');

					return { text: draftedReport({ path }), exitCode: 0 };
				}

				throw new Error(`spawn failed for ${basename(path)}`);
			},
		};
		const { params } = setupFanOut({ count: 3, driver });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'failed');
		// both failures are named: one bad phase must not hide the other nine
		expect(result.error).toContain('phase1-step.md: agent invocation failed');
		expect(result.error).toContain('phase3-step.md: agent invocation failed');
	});

	test('a phase claiming a file it never wrote returns failed naming that path', async () => {
		const driver = phaseDriver({ respond: ({ file, path }) => (file === 'phase2-step.md' ? { text: draftedReport({ path }), exitCode: 0 } : undefined) });
		const { cwd, params } = setupFanOut({ count: 2, driver });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'failed');
		// the agent owns the content but never the claim that it exists
		expect(result.error).toContain('not written');
		expect(result.error).toContain(join(cwd, '.lightsout', 'plans', 'demo', 'phase2-step.md'));
		expect(existsSync(join(cwd, '.lightsout', 'plans', 'demo', 'phase2-step.md'))).toBe(false);
	});

	test('the fan-out narrates its width and then each phase file as it settles', async () => {
		const { params, messages } = setupFanOut({ count: 2, driver: phaseDriver() });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'complete');
		// an unattended draft is legible from the narration alone
		expect(messages).toEqual([
			expect.stringMatching(/authoring 2 phase file\(s\), up to 8 at a time/),
			expect.stringContaining('phase1-step.md — drafted'),
			expect.stringContaining('phase2-step.md — drafted'),
		]);
	});

	test('a spawn that died is narrated as a spawn failure rather than as a report status', async () => {
		const driver = phaseDriver({ respond: () => ({ text: 'not a report', exitCode: 0 }) });
		const { params, messages } = setupFanOut({ count: 1, driver });

		const result = await authorPhaseFiles(params);

		expectStatus(result, 'failed');
		expect(messages).toEqual(expect.arrayContaining([expect.stringContaining('phase1-step.md — spawn failed')]));
	});
});
