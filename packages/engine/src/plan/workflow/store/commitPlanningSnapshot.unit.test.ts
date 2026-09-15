import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import {
	claimPlanningAttempt,
	commitPlanningSnapshot,
	importPlanningWorkspace,
	materializePlanningViews,
	PlanningLease,
	readPlanningSnapshot,
	validatePlanningRecord,
} from '#src/plan/workflow/store/index.ts';
import { artifact, candidate, completed, directories, setup, setupGraph, work } from '#tests/helpers/planningStoreAcceptanceFixture.ts';

afterEach(async () => {
	for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
const exerciseCompetition = async (context: Awaited<ReturnType<typeof setup>>) => {
	const { cwd, name, snapshot, runtime, advance } = context;
	const writers = await Promise.all(['Left plan', 'Right plan'].map((text) => commitPlanningSnapshot({ cwd, name, ...candidate({ snapshot, text }) })));
	const winner = writers.find((result) => result.committed);
	if (winner === undefined || !winner.committed) throw new Error('No writer won');
	const claim = await claimPlanningAttempt({ runtime, workId: 'investigate', expectedInputDigest: work().inputDigest });
	const observer = await claimPlanningAttempt({ runtime, workId: 'investigate', expectedInputDigest: work().inputDigest });
	advance();
	const recoverers = await Promise.all([0, 1].map(() => claimPlanningAttempt({ runtime, workId: 'investigate', expectedInputDigest: work().inputDigest })));
	const latest = await readPlanningSnapshot({ cwd, name });
	return {
		commits: writers.filter((result) => result.committed).length,
		initialClaim: claim.claimed,
		observer: observer.claimed,
		recoveryClaims: recoverers.filter((result) => result.claimed).length,
		revision: latest?.record.revision,
		attemptSequence: latest?.record.work[0].attemptSequence,
		contentMatchesWinner: latest?.artifacts.get('plan.md') === winner.snapshot.artifacts.get('plan.md'),
		calls: context.calls(),
	};
};
test('commits one generation under competing writers and recovery', async () => {
	const context = await setup();

	const result = await exerciseCompetition(context);

	expect(result).toStrictEqual({
		commits: 1,
		initialClaim: true,
		observer: false,
		recoveryClaims: 1,
		revision: 3,
		attemptSequence: 2,
		contentMatchesWinner: true,
		calls: 0,
	});
});

const setupBoundary = async ({ operation, occurrence }: { operation: string; occurrence: number }) => {
	const context = await setup();
	const next = candidate({ snapshot: context.snapshot, text: 'Replacement plan' });
	next.artifacts.set('notes.md', 'Replacement notes');
	next.record.artifacts.push(artifact({ path: 'notes.md', text: 'Replacement notes' }));
	let seen = 0;
	return {
		...context,
		next,
		io: {
			checkpoint: async (entry: { operation: string }) => {
				if (entry.operation === operation && ++seen === occurrence) throw new Error('Simulated interruption');
			},
		},
		committed: operation === 'commit',
	};
};
const exerciseBoundary = async (context: Awaited<ReturnType<typeof setupBoundary>>) => {
	const { cwd, name, next, io } = context;
	let interrupted = false;
	try {
		await commitPlanningSnapshot({ cwd, name, ...next, io });
	} catch (error) {
		interrupted = error instanceof Error && error.message === 'Simulated interruption';
	}
	const snapshot = await readPlanningSnapshot({ cwd, name });
	const digest = snapshot?.record.artifacts[0].sha256;
	await writeFile(join(cwd, '.lightsout', 'plans', name, '.planning', 'blobs', digest ?? ''), 'Corrupt bytes');
	let corruptionReported = false;
	try {
		await readPlanningSnapshot({ cwd, name });
	} catch (error) {
		corruptionReported = error instanceof Error && error.message.includes('Corrupt committed planning artifact');
	}
	return { interrupted, revision: snapshot?.record.revision, entries: [...(snapshot?.artifacts ?? [])], corruptionReported };
};
test.each([
	{ operation: 'blob', occurrence: 1 },
	{ operation: 'blob', occurrence: 2 },
	{ operation: 'candidate', occurrence: 1 },
	{ operation: 'commit', occurrence: 1 },
])('recovers coherent snapshots at every write boundary', async (boundary) => {
	const context = await setupBoundary(boundary);

	const result = await exerciseBoundary(context);

	expect(result).toStrictEqual({
		interrupted: true,
		revision: context.committed ? 1 : 0,
		entries: context.committed
			? [
					['plan.md', 'Replacement plan'],
					['notes.md', 'Replacement notes'],
				]
			: [['plan.md', 'Original plan']],
		corruptionReported: true,
	});
});

const setupReclaim = async () => {
	const context = await setup();
	const first = await claimPlanningAttempt({ runtime: context.runtime, workId: 'investigate', expectedInputDigest: work().inputDigest });
	context.advance();
	const current = await claimPlanningAttempt({ runtime: context.runtime, workId: 'investigate', expectedInputDigest: work().inputDigest });
	if (!first.claimed || !current.claimed) throw new Error('Expected initial and recovered attempts');
	const saved = await context.runtime.driver.invoke({ cwd: context.cwd, prompt: 'Investigate retry contract' });
	return { ...context, first, current, saved };
};
const exerciseSavedResult = async (context: Awaited<ReturnType<typeof setupReclaim>>) => {
	const { cwd, name, first, current, saved } = context;
	let staleRejected = false;
	try {
		await commitPlanningSnapshot({ cwd, name, ...completed({ snapshot: current.snapshot, attemptId: first.attemptId, text: 'Delayed old result' }) });
	} catch (error) {
		staleRejected = error instanceof Error && error.message.includes('current running attempt');
	}
	const prepared = completed({ snapshot: current.snapshot, attemptId: current.attemptId, text: saved.text });
	const unrelated = {
		...current.snapshot.record,
		revision: current.snapshot.record.revision + 1,
		parentDigest: current.snapshot.digest,
		sources: [{ artifact: 'background.md', locator: 'note', text: 'Unrelated context', sha256: sha256({ content: 'Unrelated context' }) }],
	};
	await commitPlanningSnapshot({
		cwd,
		name,
		expectedRevision: current.snapshot.record.revision,
		parentDigest: current.snapshot.digest,
		record: unrelated,
		artifacts: current.snapshot.artifacts,
	});
	const lost = await commitPlanningSnapshot({ cwd, name, ...prepared });
	if (lost.committed) throw new Error('Expected stale revision to lose');
	const reused = await commitPlanningSnapshot({ cwd, name, ...completed({ snapshot: lost.current, attemptId: current.attemptId, text: saved.text }) });
	const snapshot = await readPlanningSnapshot({ cwd, name });
	return {
		staleRejected,
		lost: !lost.committed,
		reused: reused.committed,
		status: snapshot?.record.work[0].status,
		currentAttempt: snapshot?.record.work[0].currentAttemptId,
		content: snapshot?.artifacts.get('plan.md'),
		preservedSource: snapshot?.record.sources[0].text,
		calls: context.calls(),
	};
};
test('fences interrupted attempts and reuses saved results', async () => {
	const context = await setupReclaim();

	const result = await exerciseSavedResult(context);

	expect(result).toStrictEqual({
		staleRejected: true,
		lost: true,
		reused: true,
		status: 'complete',
		currentAttempt: context.current.attemptId,
		content: 'Saved investigation result',
		preservedSource: 'Unrelated context',
		calls: 1,
	});
});

const setupLegacy = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'planning-import-'));
	directories.push(cwd);
	const name = 'legacy-upload';
	const root = join(cwd, '.lightsout', 'plans', name);
	const runDirectory = join(cwd, '.lightsout', 'runs', 'paused');
	await mkdir(root, { recursive: true });
	await mkdir(runDirectory, { recursive: true });
	const rows = [
		{ source: 'Brainstorm', question: 'Retry behavior?', options: 'Keep / discard', choice: 'Keep completed uploads', rationale: 'Avoid data loss' },
		{
			source: 'Brainstorm',
			question: 'Backoff?',
			options: 'Fixed / exponential',
			choice: 'Use exponential backoff',
			rationale: 'Needs investigation',
			assumption: true,
		},
	];
	const decisions = JSON.stringify({ planName: name, decisions: rows }, null, 2);
	const findings = JSON.stringify({
		planName: name,
		findings: [
			{
				id: 'f1',
				phase: 'plan.md',
				area: 'underspecified-surface',
				gap: 'Retry can duplicate a write',
				decision: 'Specify an idempotency key',
				firstSeen: 'earlier',
				lastSeen: 'earlier',
				status: 'open',
			},
		],
		updatedAt: 'earlier',
	});
	const plan = '# Legacy plan\nKeep completed uploads.\n';
	const manifest = JSON.stringify({
		runId: 'paused',
		plan: `.lightsout/plans/${name}/plan.md`,
		status: 'escalated',
		steps: [{ id: 'implement', status: 'passed' }],
	});
	await writeFile(join(root, 'plan.md'), plan);
	await writeFile(join(root, 'brainstorm-decisions.json'), decisions);
	await writeFile(join(runDirectory, 'manifest.json'), manifest);
	return {
		cwd,
		name,
		root,
		runDirectory,
		rows,
		decisions,
		findings,
		plan,
		manifest,
		inputs: {
			input: { stage: PlanningVocabulary.Stage.Implementation, sources: [], claims: [], confirmations: [] },
			artifacts: [{ descriptor: artifact({ path: 'plan.md', text: plan }), content: plan }],
			legacyDecisions: [{ path: 'brainstorm-decisions.json', content: decisions }],
			legacyFindings: { path: 'grade-memory.json', content: findings },
		},
	};
};
const exerciseImport = async (context: Awaited<ReturnType<typeof setupLegacy>>) => {
	const { cwd, name, inputs, root, runDirectory } = context;
	const first = await importPlanningWorkspace({ cwd, name, inputs });
	const second = await importPlanningWorkspace({ cwd, name, inputs });
	const archive = [...first.artifacts]
		.filter(([path]) => path.startsWith('planning-originals/') && !path.startsWith('planning-originals/decisions-'))
		.map(([, content]) => content);
	return {
		sameGeneration: first.digest === second.digest,
		originalPlan: await readFile(join(root, 'plan.md'), 'utf8'),
		originalRows: await readFile(join(root, 'brainstorm-decisions.json'), 'utf8'),
		originalRun: await readFile(join(runDirectory, 'manifest.json'), 'utf8'),
		archivedPlans: archive,
		claims: first.record.claims.map((claim) => ({
			text: claim.text,
			state: claim.state,
			confirmationId: claim.confirmationId,
			historical: claim.legacySettlementId !== undefined,
		})),
		confirmations: first.record.confirmations,
		findings: first.record.findings.map((finding) => ({ scenario: finding.scenario, state: finding.state, severity: finding.severity })),
		pendingRoles: first.record.work.filter((item) => item.status === PlanningVocabulary.WorkState.Pending).map((item) => item.role),
		reviewReceipts: first.record.reviewReceipts,
		capturedDecisionBytes: first.artifacts.get('brainstorm-decisions.json'),
	};
};
test('imports legacy progress without inventing approval', async () => {
	const context = await setupLegacy();

	const result = await exerciseImport(context);

	expect(result).toStrictEqual({
		sameGeneration: true,
		originalPlan: context.plan,
		originalRows: context.decisions,
		originalRun: context.manifest,
		archivedPlans: [context.plan],
		claims: [
			{ text: 'Keep completed uploads', state: 'settled', confirmationId: undefined, historical: true },
			{ text: 'Use exponential backoff', state: 'unresolved', confirmationId: undefined, historical: false },
		],
		confirmations: [],
		findings: [{ scenario: 'Retry can duplicate a write', state: 'open', severity: 'blocking' }],
		pendingRoles: ['investigate', 'architect', 'design-review', 'draft', 'implementation-review', 'integration-review'],
		reviewReceipts: [],
		capturedDecisionBytes: context.decisions,
	});
});

const setupProjection = async () => {
	const context = await setup();
	const next = await commitPlanningSnapshot({ cwd: context.cwd, name: context.name, ...candidate({ snapshot: context.snapshot, text: 'Current plan' }) });
	if (!next.committed) throw new Error('Unexpected competing writer');
	const root = join(context.cwd, '.lightsout', 'plans', context.name);
	await writeFile(join(root, 'plan.md'), 'Unapproved mixed projection');
	await writeFile(join(root, 'planning-views.json'), JSON.stringify({ generation: context.snapshot.digest }));
	return { ...context, root, next: next.snapshot };
};
test('keeps projections subordinate to committed generations', async () => {
	const context = await setupProjection();

	await materializePlanningViews({ cwd: context.cwd, name: context.name, snapshot: context.snapshot });

	const current = await readPlanningSnapshot({ cwd: context.cwd, name: context.name });
	expect({
		generation: current?.digest,
		text: await readFile(join(context.root, 'plan.md'), 'utf8'),
		marker: JSON.parse(await readFile(join(context.root, 'planning-views.json'), 'utf8')),
	}).toStrictEqual({
		generation: context.next.digest,
		text: 'Current plan',
		marker: { format: 'planning-views-v1', generation: context.next.digest, files: [{ path: 'plan.md', sha256: sha256({ content: 'Current plan' }) }] },
	});
});

test.each(['semantic-cycle', 'duplicate', 'dangling', 'superseded', 'execution-cycle'])(
	'validates graph references and distinguishes cycle kinds',
	async (variant) => {
		const context = await setupGraph({ variant });

		const result = validatePlanningRecord({ record: context.record });

		expect({ valid: result.valid, reported: result.issues.length > 0 }).toStrictEqual({ valid: context.valid, reported: !context.valid });
	},
);

const exercisePausedClaim = async (context: Awaited<ReturnType<typeof setup>>) => {
	let now = 0;
	let ready = () => {};
	let release = () => {};
	const entered = new Promise<void>((resolve) => {
		ready = resolve;
	});
	const resumed = new Promise<void>((resolve) => {
		release = resolve;
	});
	const parameters = { cwd: context.cwd, name: context.name, durationMs: 100, now: () => now };
	const runtime = {
		...context.runtime,
		lease: new PlanningLease({ ...parameters, token: 'initial-owner' }),
		storeIO: {
			checkpoint: async ({ operation }: { operation: string }) => {
				if (operation === 'commit') {
					ready();
					await resumed;
				}
			},
		},
	};
	const old = claimPlanningAttempt({ runtime, workId: 'investigate', expectedInputDigest: work().inputDigest }).then(
		async (claim) => {
			if (claim.claimed) await runtime.driver.invoke({ cwd: context.cwd, prompt: 'Old attempt' });
			return { dispatched: claim.claimed, failure: undefined };
		},
		(error: unknown) => ({ dispatched: false, failure: error instanceof Error ? error.message : String(error) }),
	);
	await entered;
	try {
		now = 110;
		const recoveryRuntime = { ...context.runtime, lease: new PlanningLease({ ...parameters, token: 'recovering-owner' }) };
		const recovery = await claimPlanningAttempt({ runtime: recoveryRuntime, workId: 'investigate', expectedInputDigest: work().inputDigest });
		if (recovery.claimed) await recoveryRuntime.driver.invoke({ cwd: context.cwd, prompt: 'Recovered attempt' });
		release();
		const original = await old;
		const latest = await readPlanningSnapshot({ cwd: context.cwd, name: context.name });
		return { original, recovered: recovery.claimed, calls: context.calls(), attemptSequence: latest?.record.work[0].attemptSequence };
	} finally {
		release();
	}
};
test('does not dispatch a claim reclaimed while its publication was paused', async () => {
	const context = await setup();

	const result = await exercisePausedClaim(context);

	expect(result).toStrictEqual({
		original: { dispatched: false, failure: 'A fenced planning lease cannot be revived' },
		recovered: true,
		calls: 1,
		attemptSequence: 2,
	});
});
