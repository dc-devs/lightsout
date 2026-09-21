import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { DraftImplementation, Effort, Permissions, PlanFacts, SourceEvidenceIndex } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import { draftFocusedSinglePlan } from '#src/plan/draft/focused/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createScriptedDraftDriver, type DraftRole, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** What one spawn is asked to write, keyed off the brief the focused builder emitted. */
type Respond = Parameters<typeof createScriptedDraftDriver>[0]['respond'];

/** The distinctive evidence text, planted so an assertion cannot match the file's real contents by accident. */
const evidenceMarker = 'export const one = 1; // collected-once-marker\n';

/** The clean single skeleton with `extra` further created files — 30 is the hard ceiling. */
const planCreating = ({ extra }: { extra: number }) => {
	const creates = Array.from({ length: extra }, (_, index) => `### \`src/created${index}.ts\`\n\nA new module exporting \`created${index}\`.\n`).join('\n');

	return cleanPlanBody().replace('## Files to Modify', `${creates}\n## Files to Modify`);
};

/** The default script: the one writer authors a structurally clean plan, and any repair spawn edits nothing so the loop stops. */
const cleanSingle: Respond = ({ role, path }) => (role === 'single' ? cleanPlanBody() : unchangedFixReport({ path }));

/**
 * A focused single draft ready to run: a consumer repo, its seeded plan
 * workspace, and the `DraftContext` the flow takes — including the collected
 * evidence a focused draft is handed instead of re-reading source itself.
 *
 * The driver is wrapped so every invocation is recorded whole: what a spawn was
 * granted — its requested environment, its model, its effort — rides the
 * invocation beside the prompt.
 */
const setupFocusedSingle = ({
	name,
	respond = cleanSingle,
	collected = true,
	model,
	effort,
	permissions,
}: {
	name: string;
	respond?: Respond;
	/** Whether the context carries a collected evidence index at all — `false` is a focused context wired without a collection. */
	collected?: boolean;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
}) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const planDir = planWorkspaceFolder({ cwd: cwd, name: name });
	const spawns: DriverInvocation[] = [];
	const roles: DraftRole[] = [];
	const messages: string[] = [];
	const driver = recordingDriver({
		driver: createScriptedDraftDriver({ respond, onCall: ({ role }) => roles.push(role) }),
		invocations: spawns,
	});
	const context: DraftContext = {
		cwd,
		driver,
		name,
		workspaceDir: planDir,
		facts: PlanFacts.parse({
			request: 'add a thing',
			areas: [{ area: 'core', filesToModify: [{ path: 'src/index.js', role: 'the entry point' }], namingConvention: 'camelCase' }],
			verification: { pathsChecked: 1, scriptsChecked: 0 },
			verifiedAt: '2026-01-01T00:00:00.000Z',
		}),
		decisions: emptyDecisionsRecord({ planName: name }),
		executorFileLimit: 50,
		model,
		effort,
		permissions,
		timeoutMs: 120_000,
		progress: (message) => messages.push(message),
		implementation: DraftImplementation.Focused,
		evidence: collected
			? SourceEvidenceIndex.parse({
					planName: name,
					entries: [
						{
							path: 'src/index.js',
							sha256: 'a'.repeat(64),
							kind: 'whole',
							bytes: evidenceMarker.length,
							text: evidenceMarker,
							roles: ['the entry point every module is re-exported through'],
						},
					],
					collectedAt: '2026-01-01T00:00:00.000Z',
				})
			: undefined,
	};

	return { context, cwd, planDir, spawns, roles, messages };
};

describe('draftFocusedSinglePlan', () => {
	test('requests the focused environment without touching model, effort or permissions', async () => {
		const { context, spawns } = setupFocusedSingle({
			name: 'focused-env',
			model: 'stub-model',
			effort: Effort.High,
			permissions: Permissions.FullAccess,
		});

		const result = await draftFocusedSinglePlan({ context });

		expectStatus(result, 'complete');

		const [writer] = spawns;

		// The three controls the role asks for, and the exhaustive tool allowlist:
		// a whole-object match is what rejects a tool the role never asked for, and
		// a model, effort or permission smuggled into the request — which would be
		// the blunt harness-wide "minimal mode" this deliberately is not.
		expect(writer.environment).toStrictEqual({
			noMcpServers: true,
			noSkillCatalog: true,
			toolAllowlist: true,
			settingsPreserved: true,
			tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'],
		});
		// the configured values still reach the harness the way they always have
		expect({ model: writer.model, effort: writer.effort, permissions: writer.permissions }).toStrictEqual({
			model: 'stub-model',
			effort: 'high',
			permissions: 'full-access',
		});
	});

	test("hands the writer the engine's evidence brief", async () => {
		const { context, spawns } = setupFocusedSingle({ name: 'focused-evidence' });

		const result = await draftFocusedSinglePlan({ context });

		expectStatus(result, 'complete');

		const [writer] = spawns;

		// The evidence the engine collected once reaches the writer whole — the
		// section heading, the path it was collected for, and the text itself. This
		// is what stands in place of the writer re-reading the file, and of the
		// per-symbol repository search the focused role no longer orders.
		expect({
			section: writer.prompt.includes('## Collected source evidence'),
			path: writer.prompt.includes('### `src/index.js`'),
			text: writer.prompt.includes(evidenceMarker.trim()),
		}).toStrictEqual({ section: true, path: true, text: true });
	});

	test('drafts on without an evidence section when the context carries no collection', async () => {
		const { context, spawns } = setupFocusedSingle({ name: 'focused-uncollected', collected: false });

		const result = await draftFocusedSinglePlan({ context });

		expectStatus(result, 'complete');

		const [writer] = spawns;

		// A context wired without a collection still drafts: the brief is simply
		// empty rather than a heading standing over nothing, and the writer is
		// spawned with the same focused environment either way.
		expect({
			section: writer.prompt.includes('## Collected source evidence'),
			environment: writer.environment !== undefined,
		}).toStrictEqual({ section: false, environment: true });
	});

	test('escalates once to a focused phased re-draft when the created-file ceiling is busted', async () => {
		// The engine hands a single plan exactly one output path, so a busted
		// created-file ceiling is the one blocking finding its repair loop can never
		// resolve — the draft re-runs once as phased from the same facts instead.
		const { context, planDir, roles } = setupFocusedSingle({
			name: 'focused-escalated',
			respond: ({ role, path }) => {
				if (role === 'single') {
					return planCreating({ extra: 32 });
				}

				return role === 'overview'
					? overviewBody({ rows: [phaseRow()] })
					: role === 'phase'
						? cleanPlanBody({ reference: true })
						: unchangedFixReport({ path });
			},
		});

		const result = await draftFocusedSinglePlan({ context });

		expectStatus(result, 'complete');
		// `resolvePlanDeliverable` short-circuits on plan.md, so a surviving single
		// draft would shadow the phases from grade, dedup and implement alike — and
		// the phased flow never escalates back, so exactly one overview is paid for.
		expect({
			single: existsSync(join(planDir, 'plan.md')),
			overview: existsSync(join(planDir, 'overview.md')),
			phase: existsSync(join(planDir, 'phase1-core.md')),
			variant: result.variant,
			overviewSpawns: roles.filter((role) => role === 'overview').length,
		}).toStrictEqual({ single: false, overview: true, phase: true, variant: 'overview', overviewSpawns: 1 });
	});
});
