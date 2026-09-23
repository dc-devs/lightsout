import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { DraftImplementation, PlanFacts } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import { draftSinglePlan } from '#src/plan/draft/legacy/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createScriptedDraftDriver, type DraftRole, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The legacy standalone flow reached by typing `--legacy`, exercised directly
// rather than through the dispatcher: every way its one writer spawn can end the
// draft, and the one escalation it takes. Nothing else in the suite runs these
// paths now that the focused flow holds the default.

/** The clean single skeleton with `extra` further created files — 30 is the hard ceiling. */
const planCreating = ({ extra }: { extra: number }) => {
	const creates = Array.from({ length: extra }, (_, index) => `### \`src/created${index}.ts\`\n\nA new module exporting \`created${index}\`.\n`).join('\n');

	return cleanPlanBody().replace('## Files to Modify', `${creates}\n## Files to Modify`);
};

/** A plan-writer report as the harness returns it — `filesWritten` is what the engine then verifies against disk. */
const draftReport = ({ status, filesWritten, discrepancies = [] }: { status: string; filesWritten: string[]; discrepancies?: string[] }) =>
	JSON.stringify({
		status,
		filesWritten: filesWritten.map((path) => ({ path, variant: 'single', scope: 'single' })),
		decisionsApplied: 0,
		assumptions: [],
		discrepancies,
	});

/**
 * A legacy single draft ready to run: a consumer repo, its seeded plan
 * workspace, and the `DraftContext` the flow takes with `legacy` named on it.
 *
 * No `evidence` is put on the context, because a legacy draft never collects
 * any — which is also what the assertions below read as proof the legacy flow
 * rather than the focused one produced the result.
 */
const setupLegacySingle = ({ name, driver }: { name: string; driver: Driver }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const planDir = planWorkspaceFolder({ cwd: cwd, name: name });
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
		implementation: DraftImplementation.Legacy,
		executorFileLimit: 50,
		timeoutMs: 120_000,
		progress: () => undefined,
	};

	return { context, planDir };
};

describe('draftSinglePlan', () => {
	test('a rate-limited writer parks the legacy draft before any repair', async () => {
		let calls = 0;
		const { context } = setupLegacySingle({
			name: 'legacy-parked',
			driver: {
				name: 'claude-code',
				invoke: async () => {
					calls += 1;

					return { text: '', exitCode: 1, rateLimited: true };
				},
			},
		});

		const result = await draftSinglePlan({ context });

		expectStatus(result, 'paused-rate-limit');
		// the park names the command that resumes it, rides the implementation that
		// produced it, and is reached without a re-emit retry or a repair round
		expect({ calls, implementation: result.implementation, resumable: result.error.includes('lightsout plan draft --name legacy-parked') }).toStrictEqual({
			calls: 1,
			implementation: 'legacy',
			resumable: true,
		});
	});

	test('a writer spawn that dies fails the legacy draft with the driver error', async () => {
		const { context, planDir } = setupLegacySingle({
			name: 'legacy-died',
			driver: {
				name: 'claude-code',
				invoke: async () => {
					throw new Error('spawn failed');
				},
			},
		});

		const result = await draftSinglePlan({ context });

		expectStatus(result, 'failed');
		expect({ named: result.error.includes('spawn failed'), implementation: result.implementation, plan: existsSync(join(planDir, 'plan.md')) }).toStrictEqual({
			named: true,
			implementation: 'legacy',
			plan: false,
		});
	});

	test('a writer reporting a facts discrepancy returns facts-error and writes no plan', async () => {
		const { context, planDir } = setupLegacySingle({
			name: 'legacy-facts',
			driver: {
				name: 'claude-code',
				invoke: async () => ({
					text: draftReport({ status: 'error', filesWritten: [], discrepancies: ['facts reference src/ghost.ts — does not exist'] }),
					exitCode: 0,
				}),
			},
		});

		const result = await draftSinglePlan({ context });

		expectStatus(result, 'facts-error');
		// the inputs are wrong rather than the drafting, so the discrepancies come
		// back whole and nothing is written to loop over
		expect({ discrepancies: result.discrepancies, plan: existsSync(join(planDir, 'plan.md')) }).toStrictEqual({
			discrepancies: ['facts reference src/ghost.ts — does not exist'],
			plan: false,
		});
	});

	test('a writer claiming a file it never wrote fails the legacy draft, naming that path', async () => {
		const { context, planDir } = setupLegacySingle({
			name: 'legacy-ghost',
			// Reports the file as written without ever writing it.
			driver: {
				name: 'claude-code',
				invoke: async () => ({ text: draftReport({ status: 'drafted', filesWritten: ['.lightsout/work-orders/legacy-ghost/plans/plan.md'] }), exitCode: 0 }),
			},
		});

		const result = await draftSinglePlan({ context });

		expectStatus(result, 'failed');
		// the engine verifies the write rather than trusting the claim, and says
		// which claimed path it could not find
		expect(result.error).toEqual(expect.stringContaining(join(planDir, 'plan.md')));
		expect(result.error).toEqual(expect.stringMatching(/not written/));
	});

	test('escalates once to a legacy phased re-draft when the created-file ceiling is busted', async () => {
		// The engine hands a single plan exactly one output path, so a busted
		// created-file ceiling is the one blocking finding its repair loop can never
		// resolve — the draft re-runs once as phased from the same facts instead.
		const roles: DraftRole[] = [];
		const { context, planDir } = setupLegacySingle({
			name: 'legacy-escalated',
			driver: createScriptedDraftDriver({
				onCall: ({ role }) => roles.push(role),
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
			}),
		});

		const result = await draftSinglePlan({ context });

		expectStatus(result, 'complete');
		// `resolvePlanDeliverable` short-circuits on plan.md, so a surviving single
		// draft would shadow the phases from grade, dedup and implement alike — and
		// the legacy phased flow never escalates back, so one overview is paid for
		expect({
			single: existsSync(join(planDir, 'plan.md')),
			overview: existsSync(join(planDir, 'overview.md')),
			phase: existsSync(join(planDir, 'phase1-core.md')),
			variant: result.variant,
			implementation: result.implementation,
			overviewSpawns: roles.filter((role) => role === 'overview').length,
		}).toStrictEqual({ single: false, overview: true, phase: true, variant: 'overview', implementation: 'legacy', overviewSpawns: 1 });
	});
});
