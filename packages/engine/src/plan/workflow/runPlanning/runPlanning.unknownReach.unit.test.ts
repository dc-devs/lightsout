import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningEvidence, PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { commitPlanningSnapshot, evaluatePlanningReadiness, runPlanning } from '#src/plan/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async ({ contentOnly, unavailable = false, empty = false }: { contentOnly: boolean; unavailable?: boolean; empty?: boolean }) => {
	const fixture = await planningReviewFixture();
	await writeFile(join(fixture.cwd, 'handler.ts'), 'export const retry = () => "retain uploads";');
	const invoke = fixture.runtime.driver.invoke;
	let authorResult: PlanningRoleResult | undefined;
	const assurances: string[] = [];
	let omitOnce = false;
	const unresolvedAtDiagnosis: PlanningEvidence[] = [];
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async (invocation) => {
			const output = await invoke(invocation);
			const response = PlanningRoleResult.parse(JSON.parse(output.text));
			const packet = JSON.parse(invocation.prompt).context;
			if (response.role === PlanningVocabulary.Role.Diagnose) {
				const current = await fixture.current();
				unresolvedAtDiagnosis.push(
					...current.record.evidence.filter((item) => !item.complete && item.dependencyReach === PlanningVocabulary.DependencyReach.Unknown),
				);
			}
			if (response.workId.startsWith('assurance:') && 'coverage' in response) {
				assurances.push(response.workId);
				const unknown = packet.dependencies.filter((dependency: { kind: string }) => dependency.kind === PlanningVocabulary.Dependency.Unknown);
				if (unknown.length === 0) throw new Error('Unknown assurance must receive its actual canonical dependencies');
				return {
					...output,
					text: JSON.stringify({
						...response,
						unknownAssessments: [
							{
								dependencyIds: unknown.map((dependency: { id: string }) => dependency.id),
								claimIds: response.coverage.claimIds,
								outcome: unavailable ? PlanningVocabulary.UnknownAssessment.Unavailable : PlanningVocabulary.UnknownAssessment.Unnecessary,
								reason: unavailable
									? 'Required external adapter behavior is unavailable.'
									: 'The original preservation obligation applies independently of the optional adapter behavior.',
								paths: unavailable ? ['external-adapter.ts'] : [],
								evidenceIds: [],
								citations: unavailable
									? []
									: [{ artifact: `planning-originals/${fixture.origin.sha256}.txt`, sha256: fixture.origin.sha256, quote: fixture.origin.text }],
							},
						],
					}),
				};
			}
			if (response.kind !== PlanningVocabulary.ResultKind.Terminal || !('evidence' in response)) return output;
			if (response.role !== PlanningVocabulary.Role.Architect && !response.workId.startsWith('reinvestigate:')) return output;
			const observed = packet.evidence[0];
			if (!observed)
				return {
					exitCode: 0,
					text: JSON.stringify({
						...JSON.parse(invocation.prompt).identity,
						kind: PlanningVocabulary.ResultKind.EvidenceRequest,
						requests: [
							{
								requestId: 'known-handler',
								operation: PlanningVocabulary.Operation.ReadFile,
								path: 'handler.ts',
								reason: 'Inspect known behavior while retaining uncertainty about the external adapter.',
							},
						],
					}),
				};
			const acquired = PlanningEvidence.parse(observed.evidence);
			const targets =
				response.role === PlanningVocabulary.Role.Architect
					? [{ id: 'uncertain-adapter' }]
					: (packet.incompleteEvidence ?? []).filter((item: { assignmentId: string }) => item.assignmentId === response.workId);
			if (omitOnce && response.workId.startsWith('reinvestigate:')) {
				omitOnce = false;
				return { ...output, text: JSON.stringify({ ...response, evidence: [] }) };
			}
			const semantic: PlanningRoleResult = {
				...response,
				evidence: targets.map(({ id }: { id: string }) => ({
					...acquired,
					id,
					claimIds: empty || contentOnly ? [] : ['required'],
					dependencies: contentOnly ? acquired.dependencies : [],
					dependencyReach: PlanningVocabulary.DependencyReach.Unknown,
					conclusion: empty ? '' : 'The external adapter may impose additional requirements; its dependency reach is unknown.',
					complete: true,
				})),
			};
			if (response.role === PlanningVocabulary.Role.Architect) authorResult = semantic;
			return { ...output, text: JSON.stringify(semantic) };
		},
	};
	return {
		...fixture,
		assurances,
		unresolvedAtDiagnosis,
		omitNextConclusion: () => {
			omitOnce = true;
		},
		authorResult: () => authorResult,
	};
};

test.each([false, true])(
	'requires real broad assurance for declared unknown reach without an unknown descriptor: contentOnly=%s',
	async (contentOnly) => {
		const fixture = await setup({ contentOnly });
		const first = await fixture.run();
		expect(first.status).toBe(PlanningVocabulary.Status.Complete);
		const before = await fixture.current();
		const conclusion = before.record.evidence.find((evidence) => evidence.conclusion.includes('dependency reach is unknown'));
		const author = before.record.work.find((work) => work.role === PlanningVocabulary.Role.Architect);
		if (!conclusion || !author?.resultReceiptId) throw new Error('Expected real accepted architectural uncertainty');
		const unknown = conclusion.dependencies.filter((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown);
		expect(unknown).toHaveLength(1);
		expect(unknown[0]).toEqual(expect.objectContaining({ roots: ['.'], fallbackFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }));
		expect(conclusion.dependencyReach).toBe(PlanningVocabulary.DependencyReach.Unknown);
		expect(fixture.assurances.length).toBeGreaterThan(0);
		const result = JSON.parse(before.artifacts.get(`planning-results/${sha256({ content: author.resultReceiptId })}.json`) ?? 'null');
		expect(result.resultDigest).toBe(sha256({ content: canonicalJson({ value: fixture.authorResult() }) }));
		const invocations = [...before.artifacts].filter(([path]) => path.startsWith('planning-invocations/')).map(([, text]) => JSON.parse(text));
		expect(
			invocations
				.filter((invocation) => invocation.workId === author.id)
				.every((invocation) => !invocation.dependencies.some((dependency: { id: string }) => dependency.id === unknown[0].id)),
		).toBe(true);
		const baseline = JSON.parse(before.artifacts.get(`planning-baselines/${sha256({ content: author.resultReceiptId })}.json`) ?? 'null');
		expect(baseline.dependencies).toContainEqual(unknown[0]);
		const calls = fixture.assurances.length;
		if (contentOnly) {
			const record = structuredClone(before.record);
			const legacy = record.evidence.find((evidence) => evidence.id === conclusion.id);
			if (!legacy) throw new Error('Expected the canonical conclusion');
			legacy.dependencies = legacy.dependencies.filter((dependency) => dependency.kind !== PlanningVocabulary.Dependency.Unknown);
			const unnormalized = { ...before, record };
			expect(evaluatePlanningReadiness({ snapshot: unnormalized, stage: fixture.runtime.stage, structural: [], dependenciesCurrent: true }).ready).toBe(false);
			const saved = await commitPlanningSnapshot({
				...fixture,
				expectedRevision: before.record.revision,
				parentDigest: before.digest,
				record: { ...record, revision: before.record.revision + 1, parentDigest: before.digest },
				artifacts: before.artifacts,
			});
			expect(saved.committed).toBe(true);
		}
		const second = await runPlanning({ runtime: fixture.runtime });
		const after = await fixture.current();
		expect(second.status).toBe(PlanningVocabulary.Status.Complete);
		expect(fixture.assurances.length).toBeGreaterThan(calls);
		expect(after.record.evidence.find((evidence) => evidence.id === conclusion.id)).toStrictEqual(conclusion);
		expect(after.record.work.find((work) => work.id === author.id)).toStrictEqual(author);
	},
	60_000,
);

test('blocks required unlinked unknown information instead of treating its empty dependencies as sufficient knowledge', async () => {
	const fixture = await setup({ contentOnly: true, unavailable: true });
	const result = await fixture.run();
	const snapshot = await fixture.current();
	expect(result).toEqual(
		expect.objectContaining({ status: PlanningVocabulary.Status.ExternallyBlocked, cause: expect.stringContaining('external-adapter.ts') }),
	);
	expect(fixture.assurances).toHaveLength(1);
	expect(snapshot.record.work.some((work) => work.role === PlanningVocabulary.Role.Draft && work.status === PlanningVocabulary.WorkState.Complete)).toBe(false);
	expect(snapshot.record.reviewReceipts.some((receipt) => receipt.role === PlanningVocabulary.Role.IntegrationReview)).toBe(false);
}, 60_000);

test.each([false, true])(
	'retains empty unlinked uncertainty through legacy refresh and repeated source drift: omitOnce=%s',
	async (omitOnce) => {
		const fixture = await setup({ contentOnly: true, empty: true });
		expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
		const before = await fixture.current();
		const author = before.record.work.find((work) => work.role === PlanningVocabulary.Role.Architect);
		const uncertain = before.record.evidence.find(
			(item) => item.assignmentId === author?.id && item.dependencyReach === PlanningVocabulary.DependencyReach.Unknown,
		);
		if (!author || !uncertain) throw new Error('Expected accepted unlinked uncertainty');
		expect(uncertain).toEqual(expect.objectContaining({ conclusion: '', claimIds: [], complete: true }));
		const unknown = uncertain.dependencies.find((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown);
		expect(unknown).toEqual(expect.objectContaining({ roots: ['.'] }));
		const record = structuredClone(before.record);
		const legacy = record.evidence.find((item) => item.id === uncertain.id);
		if (!legacy) throw new Error('Expected canonical evidence');
		legacy.dependencies = legacy.dependencies.filter((dependency) => dependency.kind !== PlanningVocabulary.Dependency.Unknown);
		expect(
			(
				await commitPlanningSnapshot({
					...fixture,
					expectedRevision: record.revision,
					parentDigest: before.digest,
					record: { ...record, revision: record.revision + 1, parentDigest: before.digest },
					artifacts: before.artifacts,
				})
			).committed,
		).toBe(true);
		expect((await runPlanning({ runtime: fixture.runtime })).status).toBe(PlanningVocabulary.Status.Complete);
		expect((await fixture.current()).record.evidence.find((item) => item.id === uncertain.id)).toStrictEqual(uncertain);
		const calls = fixture.assurances.length;
		for (const version of [1, 2]) {
			await writeFile(join(fixture.cwd, 'handler.ts'), `export const retry = () => "retain uploads v${version}";`);
			if (omitOnce && version === 2) fixture.omitNextConclusion();
			expect((await runPlanning({ runtime: fixture.runtime })).status).toBe(PlanningVocabulary.Status.Complete);
		}
		const after = await fixture.current();
		const investigators = after.record.work.filter((work) => work.id.startsWith('reinvestigate:'));
		expect(investigators).toHaveLength(1);
		expect(investigators[0]).toEqual(expect.objectContaining({ status: PlanningVocabulary.WorkState.Complete }));
		expect(investigators[0].attemptSequence).toBeGreaterThanOrEqual(2);
		expect(after.record.work.find((work) => work.id === author.id)).toStrictEqual(author);
		const refreshed = after.record.evidence.find((item) => item.id === uncertain.id);
		expect(refreshed).toEqual(
			expect.objectContaining({
				complete: true,
				conclusion: '',
				claimIds: [],
				dependencyReach: PlanningVocabulary.DependencyReach.Unknown,
				assignmentId: investigators[0].id,
			}),
		);
		expect(refreshed?.dependencies.find((dependency) => dependency.id === unknown?.id)).toEqual(
			expect.objectContaining({ kind: PlanningVocabulary.Dependency.Unknown }),
		);
		expect(fixture.assurances.length).toBeGreaterThan(calls);
		expect(after.record.work.some((work) => work.role === PlanningVocabulary.Role.Diagnose)).toBe(omitOnce);
		if (omitOnce)
			expect(fixture.unresolvedAtDiagnosis).toContainEqual(
				expect.objectContaining({ id: uncertain.id, complete: false, dependencyReach: PlanningVocabulary.DependencyReach.Unknown }),
			);
	},
	120_000,
);
