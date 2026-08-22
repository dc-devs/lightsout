import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { type DeclarationSpec, overviewBody } from '#tests/helpers/phasePlan.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The two-stage phased draft end to end: the door check between the stages, the
// reshape loop behind it, and the escalation that turns an over-ceiling single
// plan into a phased one.

/** Which brief the invocation builder emitted — the only thing a real writer keys off too. */
type Role = 'single' | 'overview' | 'phase' | 'reshape' | 'repair';

/** One phase row, defaulted to the counts the clean phase body actually lands on. */
const rowFor = (overrides: Partial<DeclarationSpec> = {}): DeclarationSpec => ({ number: 1, file: 'phase1-core.md', created: 1, touched: 2, ...overrides });

/** The clean single skeleton with `extra` further created files — 30 is the hard ceiling. */
const planCreating = ({ extra }: { extra: number }) => {
	const creates = Array.from({ length: extra }, (_, index) => `### \`src/created${index}.ts\`\n\nA new module exporting \`created${index}\`.\n`).join('\n');

	return cleanPlanBody().replace('## Files to Modify', `${creates}\n## Files to Modify`);
};

const briefRole = ({ prompt }: { prompt: string }): Role => {
	if (prompt.includes('# Reshape input')) {
		return 'reshape';
	}

	if (prompt.includes('# Repair input')) {
		return 'repair';
	}

	if (prompt.includes('## Phase authoring')) {
		return 'phase';
	}

	return prompt.includes('## Overview only') ? 'overview' : 'single';
};

/** A fixed-report answer a scripted spawn returns instead of authoring a body. */
type DriverAnswer = string | { text: string; exitCode: number; rateLimited?: boolean };

/** The plan-writer's drafted report for one authored file. */
const draftedReport = ({ path, role }: { path: string; role: Role }) =>
	JSON.stringify({
		status: 'drafted',
		filesWritten: [{ path, variant: role === 'single' ? 'single' : role, scope: role }],
		decisionsApplied: 0,
		assumptions: [],
		discrepancies: [],
	});

/**
 * A stub harness answering every spawn shape the phased draft can emit. It reads
 * the role off the brief and the output path off the prompt, exactly as a real
 * writer would, and `respond` decides what that spawn does.
 */
const draftDriver = ({
	respond,
	onCall,
}: {
	respond: (params: { role: Role; path: string; file: string }) => DriverAnswer;
	onCall?: (params: { role: Role; file: string }) => void;
}): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		const role = briefRole({ prompt });
		const path = /- (\S+\.md)/.exec(prompt)?.[1];

		// every spawn is handed exactly the paths the engine chose
		expectDefined(path);
		onCall?.({ role, file: basename(path) });

		const answer = respond({ role, path, file: basename(path) });

		if (typeof answer !== 'string') {
			return answer;
		}

		writeFileSync(path, answer);

		return role === 'reshape' || role === 'repair'
			? { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 }
			: { text: draftedReport({ path, role }), exitCode: 0 };
	},
});

/** A repair or reshape spawn that edits nothing — the finding set comes back identical, so the loop stops. */
const unchanged = ({ path }: { path: string }): DriverAnswer => ({
	text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }),
	exitCode: 0,
});

/** A seeded plan workspace whose facts touch enough paths to estimate `overview`, plus the collectors the act writes into. */
const setupPhasedDraft = ({ name, touching = 41, executorFileLimit }: { name: string; touching?: number; executorFileLimit?: number }) => {
	const cwd = setupConsumerRepo({ config: executorFileLimit === undefined ? undefined : { 'executor-file-limit': executorFileLimit } });

	seedPlanWorkspace({
		cwd,
		name,
		areas: [
			{
				area: 'core',
				filesToModify: Array.from({ length: touching }, (_, index) => ({ path: `src/mod${index}.ts`, role: 'touched' })),
				patternsToMirror: [],
				namingConvention: 'camelCase',
			},
		],
	});

	const calls: { role: Role; file: string }[] = [];
	const messages: string[] = [];

	return { cwd, name, calls, messages, planDir: join(cwd, '.lightsout', 'plans', name), onProgress: (message: string) => messages.push(message) };
};

describe('runPlanDraft phased', () => {
	test('a single plan that busts the created-file ceiling is re-drafted phased, its abandoned plan.md deleted first', async () => {
		// The scope estimate reads only the facts' touched paths, which carry no
		// create-paths — so a plan estimated as comfortably single can still
		// author forty new files.
		const draft = setupPhasedDraft({ name: 'escalated', touching: 0 });
		const driver = draftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) => {
				if (role === 'single') {
					return planCreating({ extra: 32 });
				}

				return role === 'overview' ? overviewBody({ rows: [rowFor()] }) : role === 'phase' ? cleanPlanBody() : unchanged({ path });
			},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name, onProgress: draft.onProgress });

		expectStatus(result, 'complete');
		// resolvePlanDeliverable short-circuits on plan.md, so a surviving single
		// draft would shadow the phases from grade, dedup and implement alike
		expect({
			single: existsSync(join(draft.planDir, 'plan.md')),
			overview: existsSync(join(draft.planDir, 'overview.md')),
			phase: existsSync(join(draft.planDir, 'phase1-core.md')),
			variant: result.variant,
			reports: result.reports.length,
		}).toStrictEqual({ single: false, overview: true, phase: true, variant: 'overview', reports: 2 });
		expect(draft.messages).toEqual(expect.arrayContaining([expect.stringMatching(/over the 30-file ceiling.*re-drafting phased/)]));
	});

	test('the phased re-draft never escalates back — a phase over the ceiling hands back instead', async () => {
		const draft = setupPhasedDraft({ name: 'once-only', touching: 0 });
		const driver = draftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) => {
				if (role === 'single') {
					return planCreating({ extra: 32 });
				}

				// the declaration passes the door check; the phase file itself does not
				return role === 'overview' ? overviewBody({ rows: [rowFor()] }) : role === 'phase' ? planCreating({ extra: 32 }) : unchanged({ path });
			},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'structural-issues');
		// re-splitting here would invalidate every phase file already authored,
		// paying for the whole fan-out twice to fix one phase
		expect(draft.calls.filter(({ role }) => role === 'overview').length).toBe(1);
		expect(result.findings.map(({ check, phase }) => ({ check, phase }))).toEqual(
			expect.arrayContaining([{ check: 'created-files-within-ceiling', phase: 'phase1-core.md' }]),
		);
	});

	test('a declared phase over the ceiling is refused before a single phase spawn is paid for', async () => {
		const draft = setupPhasedDraft({ name: 'refused' });
		const driver = draftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) => (role === 'overview' ? overviewBody({ rows: [rowFor({ created: 31 })] }) : unchanged({ path })),
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'structural-issues');
		// the cheapest moment a plan can be refused is before the fan-out, and
		// only the overview exists to hand back
		expect({ roles: draft.calls.map(({ role }) => role), planPaths: result.planPaths }).toStrictEqual({
			roles: ['overview', 'reshape'],
			planPaths: [join(draft.planDir, 'overview.md')],
		});
		expect(existsSync(join(draft.planDir, 'phase1-core.md'))).toBe(false);
	});

	test('a reshaped breakdown is what the phase fan-out is then authored against', async () => {
		const draft = setupPhasedDraft({ name: 'reshaped' });
		let overviews = 0;
		const driver = draftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) => {
				if (role === 'overview') {
					overviews += 1;

					return overviewBody({ rows: [rowFor({ created: 31 })] });
				}

				return role === 'reshape' ? overviewBody({ rows: [rowFor()] }) : role === 'phase' ? cleanPlanBody() : unchanged({ path });
			},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'complete');
		// the reshape settles the declaration, and only then is a phase agent spawned
		expect({ roles: draft.calls.map(({ role }) => role), overviews }).toStrictEqual({ roles: ['overview', 'reshape', 'phase'], overviews: 1 });
	});

	test('a breakdown advisory rides the complete result rather than being computed and dropped', async () => {
		const draft = setupPhasedDraft({ name: 'noted' });
		const driver = draftDriver({
			respond: ({ role, path }) =>
				role === 'overview' ? overviewBody({ rows: [rowFor({ touched: 51 })] }) : role === 'phase' ? cleanPlanBody() : unchanged({ path }),
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'complete');
		// the warning is the human's only notice of what this plan will cost to
		// review, and it is raised before any phase file exists to raise it again
		expect(result.advisories.map(({ check, phase }) => ({ check, phase }))).toStrictEqual([{ check: 'scope-within-guardrail', phase: 'overview.md' }]);
	});

	test('a rate-limited reshape parks the draft before the fan-out', async () => {
		const draft = setupPhasedDraft({ name: 'parked-reshape' });
		const driver = draftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role }) => (role === 'overview' ? overviewBody({ rows: [rowFor({ created: 31 })] }) : { text: '', exitCode: 1, rateLimited: true }),
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'paused-rate-limit');
		expect({ roles: draft.calls.map(({ role }) => role), advisories: result.advisories }).toStrictEqual({ roles: ['overview', 'reshape'], advisories: [] });
		expect(result.error).toContain('lightsout plan draft --name parked-reshape');
	});

	test('a rate-limited phase spawn parks the draft, carrying the breakdown note it already raised', async () => {
		const draft = setupPhasedDraft({ name: 'parked-phase' });
		const driver = draftDriver({
			respond: ({ role }) => (role === 'overview' ? overviewBody({ rows: [rowFor({ touched: 51 })] }) : { text: '', exitCode: 1, rateLimited: true }),
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'paused-rate-limit');
		// advisories ride every member, so the note reaches the human whichever
		// way the draft ended
		expect(result.advisories.map(({ check }) => check)).toStrictEqual(['scope-within-guardrail']);
	});

	test('a phase spawn reporting a facts discrepancy returns facts-error naming its phase file', async () => {
		const draft = setupPhasedDraft({ name: 'phase-facts' });
		const driver = draftDriver({
			respond: ({ role }) =>
				role === 'overview'
					? overviewBody({ rows: [rowFor()] })
					: {
							text: JSON.stringify({
								status: 'error',
								filesWritten: [],
								decisionsApplied: 0,
								assumptions: [],
								discrepancies: ['facts reference src/ghost.ts — does not exist'],
							}),
							exitCode: 0,
						},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'facts-error');
		expect(result.discrepancies).toStrictEqual(['phase1-core.md: facts reference src/ghost.ts — does not exist']);
	});

	test('a rate-limited overview spawn parks before the door check ever runs', async () => {
		const draft = setupPhasedDraft({ name: 'parked-overview' });
		const driver = draftDriver({ onCall: (call) => draft.calls.push(call), respond: () => ({ text: '', exitCode: 1, rateLimited: true }) });

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'paused-rate-limit');
		// nothing downstream of the overview is paid for, and no check has run to
		// produce a note
		expect({ roles: draft.calls.map(({ role }) => role), advisories: result.advisories }).toStrictEqual({ roles: ['overview'], advisories: [] });
	});

	test('a reshaper that destroys the overview fails the draft rather than fanning out over nothing', async () => {
		const draft = setupPhasedDraft({ name: 'lost-overview' });
		const driver = draftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) => {
				if (role === 'overview') {
					return overviewBody({ rows: [rowFor({ created: 31 })] });
				}

				rmSync(path);

				return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
			},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'failed');
		expect({ roles: draft.calls.map(({ role }) => role), error: result.error }).toStrictEqual({
			roles: ['overview', 'reshape'],
			error: `overview could not be read at ${join(draft.planDir, 'overview.md')}`,
		});
	});

	test('a phase spawn that died fails the draft, naming the phase file it was authoring', async () => {
		const draft = setupPhasedDraft({ name: 'phase-died' });
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (prompt.includes('## Phase authoring')) {
					throw new Error('spawn failed');
				}

				const path = /- (\S+\.md)/.exec(prompt)?.[1];

				expectDefined(path);
				writeFileSync(path, overviewBody({ rows: [rowFor()] }));

				return { text: draftedReport({ path, role: 'overview' }), exitCode: 0 };
			},
		};

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'failed');
		expect(result.error).toContain('phase1-core.md: agent invocation failed');
	});

	test.each([
		{ outcome: 'rate-limited', status: 'paused-rate-limit' as const, answer: { text: '', exitCode: 1, rateLimited: true } },
		{ outcome: 'dead', status: 'failed' as const, answer: { text: 'not a report', exitCode: 0 } },
	])('a $outcome closing structural repair ends the draft as $status, still carrying the breakdown note', async ({ status, answer }) => {
		const draft = setupPhasedDraft({ name: `closing-${status}` });
		const driver = draftDriver({
			respond: ({ role }) => {
				if (role === 'overview') {
					return overviewBody({ rows: [rowFor({ touched: 51 })] });
				}

				// a placeholder in the phase file is what forces the closing repair
				return role === 'phase' ? cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting') : answer;
			},
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, status);
		expect(result.advisories.map(({ check }) => check)).toStrictEqual(['scope-within-guardrail']);
	});

	test('a configured executor-file-limit is the number the variant is estimated against', async () => {
		// The threshold is four fifths of the limit, so a limit of 10 puts it at 8
		// and nine touched paths draft phased — where the default 50 would have put
		// it at 40 and drafted a single plan from the identical facts.
		const draft = setupPhasedDraft({ name: 'lowered-limit', touching: 9, executorFileLimit: 10 });
		const driver = draftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) => (role === 'overview' ? overviewBody({ rows: [rowFor()] }) : role === 'phase' ? cleanPlanBody() : unchanged({ path })),
		});

		const result = await runPlanDraft({ cwd: draft.cwd, driver, name: draft.name });

		expectStatus(result, 'complete');
		// the repo's own setting reaches the estimate rather than the built-in default
		expect({ variant: result.variant, roles: draft.calls.map(({ role }) => role) }).toStrictEqual({ variant: 'overview', roles: ['overview', 'phase'] });
	});
});
