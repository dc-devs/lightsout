import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { Effort, Permissions, PlanDraftReport, PlanVariant } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** One explorer area whose facts touch the given modify and mirror paths. */
const areaTouching = ({ modify = [], mirror = [] }: { modify?: string[]; mirror?: string[] }) => ({
	area: 'core',
	filesToModify: modify.map((path) => ({ path, role: 'touched' })),
	patternsToMirror: mirror.map((path) => ({ path, takeaway: 'shape' })),
	namingConvention: 'camelCase',
});

/** `count` distinct repo-relative paths for the scope estimate. */
const paths = (count: number) => Array.from({ length: count }, (_, index) => `src/mod${index}.ts`);

/** The clean skeleton with the given placeholder markers planted — one lint finding per distinct marker. */
const planWithMarkers = ({ markers }: { markers: string }) => cleanPlanBody().replace('A new module exporting', `${markers} — a new module exporting`);

/** Same skeleton but with a planted placeholder, so the structural lint flags it. */
const dirtyPlan = () => planWithMarkers({ markers: 'TBD' });

test('plan draft: writes plan.md and returns a valid PlanDraftReport — with no config on disk at all', async () => {
	// A bare repo, deliberately without lightsout.config.json: the draft flow
	// tolerates a missing config rather than requiring one.
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-draft-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/index.js'), 'export const one = 1;\n');
	seedPlanWorkspace({ cwd, name: 'draft-me' });

	const planDir = join(cwd, '.lightsout', 'plans', 'draft-me');
	const result = await runPlanDraft({ cwd, driver: createDraftDriver({ bodies: [cleanPlanBody()] }), name: 'draft-me' });

	expectStatus(result, 'complete');
	// plan.md written into the plan's own folder, beside its workspace files
	expect(existsSync(join(planDir, 'plan.md'))).toBeTruthy();
	// one spawn, one report: the array is how a phased draft returns one per
	// phase without merging several agents' assumptions into a single object
	expect('reports' in result && result.reports.length === 1).toBeTruthy();
	// the writer's report comes back whole — parse throws on a shape violation,
	// and the values pin what the caller actually reads off it
	expect(PlanDraftReport.parse(result.reports[0])).toStrictEqual({
		status: 'drafted',
		filesWritten: [{ path: join(planDir, 'plan.md'), variant: 'single', scope: 'single' }],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: [],
	});
	expect('planPaths' in result).toBeTruthy();
	// the verified deliverable path comes back for the session to grade
	expect(result.planPaths).toStrictEqual([join(planDir, 'plan.md')]);
});

test('plan draft: the writer is handed the self-lint command and granted exactly the prefix it starts with', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'self-lint' });

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'self-lint' });

	expectStatus(result, 'complete');

	const [writer] = invocations;

	// the writer carries exactly one command grant
	expect(writer.allowedCommands?.length).toBe(1);

	const prefix = writer.allowedCommands?.[0] ?? '';

	// the grant is the plan-lint prefix, got: ${prefix}
	expect(prefix.endsWith(' plan lint')).toBeTruthy();
	// the granted prefix is unquoted — the harness matches it literally
	expect(prefix.includes('"')).toBeFalsy();
	// the embedded command extends the granted prefix verbatim, the consumer path
	// quoted, got: ${writer.prompt}
	expect(writer.prompt.includes(`${prefix} --name self-lint --cwd "${cwd}"`)).toBeTruthy();
});

test('plan draft: the repair invocation gets no self-lint command and no command grant', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'repair-ungranted' });

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [dirtyPlan(), cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'repair-ungranted' });

	expectStatus(result, 'complete');

	const repairInvocation = invocations.find((invocation) => invocation.prompt.includes('# Repair input'));

	// the dirty author forced a repair
	expectDefined(repairInvocation);
	// the grant is scoped to the writer alone
	expect(repairInvocation.allowedCommands).toBe(undefined);
	// the repairer is never told to self-lint
	expect(repairInvocation.prompt.includes('plan lint')).toBeFalsy();
});

test('plan draft: the repair invocation references the workspace facts/decisions by path, never inlined', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'repair-refs' });

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [dirtyPlan(), cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'repair-refs' });

	expectStatus(result, 'complete');

	const repairInvocation = invocations.find((invocation) => invocation.prompt.includes('# Repair input'));

	// the dirty author forced a repair
	expectDefined(repairInvocation);

	const workspaceDir = join(cwd, '.lightsout', 'plans', 'repair-refs');

	// the decisions reference is the workspace path
	expect(repairInvocation.prompt.includes(`- Decisions record: ${join(workspaceDir, 'decisions.json')}`)).toBeTruthy();
	// the facts reference is the workspace path
	expect(repairInvocation.prompt.includes(`- Verified facts: ${join(workspaceDir, 'facts.json')}`)).toBeTruthy();
	// no brainstorm file was seeded, so no brainstorm reference line appears
	expect(repairInvocation.prompt.includes('brainstorm-decisions.json')).toBeFalsy();
	// the seeded facts content never rides the prompt
	expect(repairInvocation.prompt.includes('do a thing')).toBeFalsy();
	// no fenced JSON reference block survives in the prompt
	expect(repairInvocation.prompt.includes('```json')).toBeFalsy();
});

test('plan draft: the resolved effort and permissions ride the writer and every repair invocation', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'effort-threaded' });

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [dirtyPlan(), cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({
		cwd,
		driver,
		name: 'effort-threaded',
		effort: Effort.High,
		permissions: Permissions.FullAccess,
	});

	expectStatus(result, 'complete');
	// a repair must run at the same effort and capability level the writer got
	expect(
		invocations.map(({ prompt, effort, permissions }) => ({ role: prompt.includes('# Repair input') ? 'repair' : 'writer', effort, permissions })),
	).toStrictEqual([
		{ role: 'writer', effort: 'high', permissions: 'full-access' },
		{ role: 'repair', effort: 'high', permissions: 'full-access' },
	]);
});

test('plan draft: an unset effort and permissions reach the driver undefined — no default is invented here', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'no-effort' });

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'no-effort' });

	expectStatus(result, 'complete');
	// the caller resolves the level; this role never substitutes one of its own
	expect(invocations.map(({ effort, permissions }) => ({ effort, permissions }))).toStrictEqual([{ effort: undefined, permissions: undefined }]);
});

test('plan draft: a TBD author then a clean repair proves the repair loop converges without re-authoring', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'converge' });

	const prompts: string[] = [];
	const driver = createDraftDriver({ bodies: [dirtyPlan(), cleanPlanBody()], onCall: (prompt) => prompts.push(prompt) });
	const result = await runPlanDraft({ cwd, driver, name: 'converge' });

	expectStatus(result, 'complete');
	// the dirty author forced exactly one repair
	expect(prompts.length).toBe(2);
	// attempt 1 authors
	expect(prompts[0].includes('# Draft input')).toBeTruthy();
	// the author prompt carries no corrective findings section
	expect(prompts[0].includes('Structural findings')).toBeFalsy();
	// attempt 2 is a repair, never a re-author
	expect(prompts[1].includes('# Repair input')).toBeTruthy();
});

test('plan draft: a report.status of error returns facts-error and writes no plan', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'bad-facts' });

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({
			text: JSON.stringify({
				status: 'error',
				filesWritten: [],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: ['facts reference src/ghost.ts — does not exist'],
			}),
			exitCode: 0,
		}),
	};
	const result = await runPlanDraft({ cwd, driver, name: 'bad-facts' });

	expectStatus(result, 'facts-error');
	expect('discrepancies' in result && result.discrepancies.length === 1).toBeTruthy();
	// no plan written on facts-error
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'bad-facts', 'plan.md'))).toBeFalsy();
});

/** A structurally clean overview file — the overview variant's own required section set, its counts equal to what its one phase file lists. */
const cleanOverview = () => `# Drafted Plan — Overview

## Global Constraints

- None

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | \`phase1-core.md\` | the core | 1 | 1 |

## Phase Declarations

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

## Cross-Phase Dependencies

- None.
`;

/**
 * The phased writer stub, answering both stages of the two-stage draft: an
 * overview spawn writes `overview.md` alone, and each phase spawn writes the one
 * phase file its prompt names. Which stage it is in is read off the brief the
 * builder emitted, exactly as a real writer would.
 */
const phasedDraftDriver = ({ onCall, phaseBody = cleanPlanBody() }: { onCall?: (prompt: string) => void; phaseBody?: string } = {}): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		onCall?.(prompt);

		const path = /- (\S+\.md)/.exec(prompt)?.[1];

		// the engine dictates one output path per spawn
		expectDefined(path);

		const phase = prompt.includes('## Phase authoring');

		writeFileSync(path, phase ? phaseBody : cleanOverview());

		return {
			text: JSON.stringify({
				status: 'drafted',
				filesWritten: [{ path, variant: phase ? PlanVariant.Phase : PlanVariant.Overview, scope: phase ? 'the core' : 'phased' }],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: [],
			}),
			exitCode: 0,
		};
	},
});

test('plan draft: facts touching more paths than the phased threshold draft the overview variant', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'big', areas: [areaTouching({ modify: paths(41) })] });

	const prompts: string[] = [];
	const result = await runPlanDraft({ cwd, driver: phasedDraftDriver({ onCall: (prompt) => prompts.push(prompt) }), name: 'big' });

	expectStatus(result, 'complete');
	expect('variant' in result).toBeTruthy();
	expect(result.variant).toBe('overview');
	// the phased deliverable is authored into the plan's own folder
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'big', 'overview.md'))).toBeTruthy();
	// and its one declared phase was authored by its own spawn, not by the
	// overview's — the split that keeps a ten-phase draft inside its timeout
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'big', 'phase1-core.md'))).toBeTruthy();
	expect(prompts.map((prompt) => (prompt.includes('## Phase authoring') ? 'phase' : 'overview'))).toStrictEqual(['overview', 'phase']);
	// the overview spawn is never handed a self-lint: no phase file exists yet,
	// so the command it would run always answers "no plan found"
	expect(prompts[0].includes('## Self-lint')).toBeFalsy();
	// one report per spawn, the overview's first
	expect('reports' in result && result.reports.length).toBe(2);
});

test('plan draft: the overview\u2019s declared counts are re-stamped from what the phase files actually list', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'stamped', areas: [areaTouching({ modify: paths(41) })] });

	const result = await runPlanDraft({ cwd, driver: phasedDraftDriver(), name: 'stamped' });

	expectStatus(result, 'complete');

	const overview = readFileSync(join(cwd, '.lightsout', 'plans', 'stamped', 'overview.md'), 'utf8');

	// the estimate the overview agent wrote is replaced by the count the phase
	// file proves, so the consistency check never spends a repair on arithmetic
	expect(overview).toContain('| 1 | `phase1-core.md` | the core | 1 | 1 |');
});

test('plan draft: an explicit scope flag overrides the estimate', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'forced', areas: [areaTouching({ modify: paths(41) })] });

	const result = await runPlanDraft({
		cwd,
		driver: createDraftDriver({ bodies: [cleanPlanBody()] }),
		name: 'forced',
		scope: PlanVariant.Single,
	});

	expectStatus(result, 'complete');
	expect('variant' in result).toBeTruthy();
	// the flag wins over the 41-path estimate
	expect(result.variant).toBe('single');
});

/** The one surface a declaring repository writes in the cases below. */
const declaredDocs = [{ path: 'docs/configuration.md', covers: 'Every configuration key.' }];

test('plan draft: a repository declaring documentation surfaces briefs the writer and the repairer alike', async () => {
	const cwd = setupConsumerRepo({ config: { docs: declaredDocs } });

	seedPlanWorkspace({ cwd, name: 'declared' });

	const prompts: string[] = [];
	// the first body omits the section the declared block makes required, so the
	// structural lint forces exactly one repair round
	const driver = createDraftDriver({
		bodies: [cleanPlanBody(), cleanPlanBody({ documentation: 'Nothing user-facing — no docs needed.' })],
		onCall: (prompt) => prompts.push(prompt),
	});
	const result = await runPlanDraft({ cwd, driver, name: 'declared' });

	expectStatus(result, 'complete');

	const writer = prompts.find((prompt) => prompt.includes('# Draft input'));
	const repairer = prompts.find((prompt) => prompt.includes('# Repair input'));

	expectDefined(writer);
	expectDefined(repairer);
	// the repair role forbids inventing a section's content, so an unbriefed
	// repairer would either break that rule or fail the draft
	expect(writer.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
	expect(repairer.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
});

test('plan draft: a declared repository briefs its overview and phase spawns on the same surfaces', async () => {
	const cwd = setupConsumerRepo({ config: { docs: declaredDocs } });

	seedPlanWorkspace({ cwd, name: 'declared-phased', areas: [areaTouching({ modify: paths(41) })] });

	const prompts: string[] = [];
	const driver = phasedDraftDriver({
		onCall: (prompt) => prompts.push(prompt),
		phaseBody: cleanPlanBody({ documentation: 'Nothing user-facing — no docs needed.' }),
	});
	const result = await runPlanDraft({ cwd, driver, name: 'declared-phased' });

	expectStatus(result, 'complete');
	// a phase file carries the claim a single plan would, so the phase spawn is
	// told what the repository declared — and the overview spawn is briefed from
	// the same config rather than from a second copy of it
	expect(prompts.map((prompt) => prompt.includes('- `docs/configuration.md` — Every configuration key.'))).toStrictEqual([true, true]);
});
