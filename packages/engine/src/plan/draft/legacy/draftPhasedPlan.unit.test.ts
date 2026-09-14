import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { DraftImplementation, PlanFacts } from '#src/contracts/index.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import { draftPhasedPlan } from '#src/plan/draft/legacy/index.ts';
import { createScriptedDraftDriver, type DraftRole, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The legacy two-stage flow reached by typing `--legacy`, exercised directly:
// the overview spawn, the deterministic door check between the stages, and every
// way the concurrent fan-out behind it can end the draft. The dispatcher's own
// suite drafts focused now, so nothing else runs these paths.

/** A rate-limited harness answer — the wall a legacy draft parks against wherever it meets it. */
const rateLimited = { text: '', exitCode: 1, rateLimited: true };

/** A phase spawn's report of a discrepancy in the verified facts, which is an input defect rather than a drafting one. */
const phaseFactsError = {
	text: JSON.stringify({
		status: 'error',
		filesWritten: [],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: ['facts reference src/ghost.ts — does not exist'],
	}),
	exitCode: 0,
};

/**
 * A legacy phased draft ready to run: a consumer repo, its seeded plan
 * workspace, a scripted harness answering every spawn shape the two stages can
 * emit, and the `DraftContext` the flow takes with `legacy` named on it.
 *
 * The context carries no `evidence`, because a legacy draft never collects any.
 */
const setupLegacyPhased = ({ name, respond }: { name: string; respond: Parameters<typeof createScriptedDraftDriver>[0]['respond'] }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const planDir = join(cwd, '.lightsout', 'plans', name);
	const roles: DraftRole[] = [];
	const context: DraftContext = {
		cwd,
		driver: createScriptedDraftDriver({ respond, onCall: ({ role }) => roles.push(role) }),
		name,
		workspaceDir: planDir,
		facts: PlanFacts.parse({
			request: 'split the drafting module',
			areas: [{ area: 'core', filesToModify: [{ path: 'src/index.js', role: 'the entry point' }], namingConvention: 'camelCase' }],
			verification: { pathsChecked: 1, scriptsChecked: 0 },
			verifiedAt: '2026-01-01T00:00:00.000Z',
		}),
		decisions: emptyDecisionsRecord({ planName: name }),
		implementation: DraftImplementation.Legacy,
		executorFileLimit: 50,
		timeoutMs: 120_000,
		progress: () => undefined,
	};

	return { context, planDir, roles };
};

describe('draftPhasedPlan', () => {
	test('an overview spawn that dies fails the legacy draft before the door check', async () => {
		const { context, roles } = setupLegacyPhased({
			name: 'legacy-overview-died',
			respond: () => {
				throw new Error('spawn failed');
			},
		});

		const result = await draftPhasedPlan({ context, step: 'draft' });

		expectStatus(result, 'failed');
		// nothing downstream of the overview is paid for, and no check has run to
		// produce a note
		expect({ named: result.error.includes('spawn failed'), roles, advisories: result.advisories, implementation: result.implementation }).toStrictEqual({
			named: true,
			roles: ['overview'],
			advisories: [],
			implementation: 'legacy',
		});
	});

	test('a declared phase over the ceiling is refused before a single phase spawn is paid for', async () => {
		const { context, planDir, roles } = setupLegacyPhased({
			name: 'legacy-refused',
			respond: ({ role, path }) => (role === 'overview' ? overviewBody({ rows: [phaseRow({ created: 31 })] }) : unchangedFixReport({ path })),
		});

		const result = await draftPhasedPlan({ context, step: 'draft' });

		expectStatus(result, 'structural-issues');
		// the cheapest moment a plan can be refused is before the fan-out, and only
		// the overview exists to hand back
		expect({ roles, planPaths: result.planPaths, phase: existsSync(join(planDir, 'phase1-core.md')) }).toStrictEqual({
			roles: ['overview', 'reshape'],
			planPaths: [join(planDir, 'overview.md')],
			phase: false,
		});
		expect(result.findings.map(({ check }) => check)).toEqual(expect.arrayContaining(['created-files-within-ceiling']));
	});

	test('a rate-limited reshape parks the legacy draft before the fan-out', async () => {
		const { context, roles } = setupLegacyPhased({
			name: 'legacy-parked-reshape',
			respond: ({ role }) => (role === 'overview' ? overviewBody({ rows: [phaseRow({ created: 31 })] }) : rateLimited),
		});

		const result = await draftPhasedPlan({ context, step: 'draft' });

		expectStatus(result, 'paused-rate-limit');
		expect({ roles, advisories: result.advisories, resumable: result.error.includes('lightsout plan draft --name legacy-parked-reshape') }).toStrictEqual({
			roles: ['overview', 'reshape'],
			advisories: [],
			resumable: true,
		});
	});

	test('a reshaper that destroys the overview fails the legacy draft rather than fanning out over nothing', async () => {
		const { context, planDir, roles } = setupLegacyPhased({
			name: 'legacy-lost-overview',
			respond: ({ role, path }) => {
				if (role === 'overview') {
					return overviewBody({ rows: [phaseRow({ created: 31 })] });
				}

				rmSync(path);

				return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
			},
		});

		const result = await draftPhasedPlan({ context, step: 'draft' });

		expectStatus(result, 'failed');
		expect({ roles, error: result.error }).toStrictEqual({
			roles: ['overview', 'reshape'],
			error: `overview could not be read at ${join(planDir, 'overview.md')}`,
		});
	});

	test('a phase spawn reporting a facts discrepancy returns facts-error naming its phase file', async () => {
		const { context } = setupLegacyPhased({
			name: 'legacy-phase-facts',
			respond: ({ role }) => (role === 'overview' ? overviewBody({ rows: [phaseRow()] }) : phaseFactsError),
		});

		const result = await draftPhasedPlan({ context, step: 'draft' });

		expectStatus(result, 'facts-error');
		// one bad phase must never hide which phase it was
		expect(result.discrepancies).toStrictEqual(['phase1-core.md: facts reference src/ghost.ts — does not exist']);
	});

	test('a rate-limited phase spawn parks the legacy draft, carrying the breakdown note it already raised', async () => {
		const { context } = setupLegacyPhased({
			name: 'legacy-parked-phase',
			respond: ({ role }) => (role === 'overview' ? overviewBody({ rows: [phaseRow({ touched: 51 })] }) : rateLimited),
		});

		const result = await draftPhasedPlan({ context, step: 'draft' });

		expectStatus(result, 'paused-rate-limit');
		// the warning is the human's only notice of what reviewing this plan will
		// cost, so it rides whichever way the draft ended
		expect(result.advisories.map(({ check, phase }) => ({ check, phase }))).toStrictEqual([{ check: 'scope-within-guardrail', phase: 'overview.md' }]);
	});

	test('a phase spawn that died fails the legacy draft, naming the phase file it was authoring', async () => {
		const { context } = setupLegacyPhased({
			name: 'legacy-phase-died',
			respond: ({ role }) => {
				if (role === 'phase') {
					throw new Error('spawn failed');
				}

				return overviewBody({ rows: [phaseRow()] });
			},
		});

		const result = await draftPhasedPlan({ context, step: 'draft' });

		expectStatus(result, 'failed');
		expect(result.error).toContain('phase1-core.md: agent invocation failed');
	});
});
