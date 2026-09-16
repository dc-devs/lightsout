import { expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/index.ts';
import { getCurrentPlanningReviews, planningFindingSettlement } from '#src/plan/workflow/review/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async () => {
	let observed = false;
	const fixture = await planningReviewFixture({
		respond: ({ response, snapshot }) => {
			if (!observed && response.role === PlanningVocabulary.Role.ImplementationReview && 'coverage' in response) {
				observed = true;
				const source = snapshot.record.sources[0];
				const citations = [{ artifact: `planning-originals/${source.sha256}.txt`, sha256: source.sha256, quote: source.text }];
				const finding = {
					id: 'disputed-original',
					observationIds: ['original-reading'],
					scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
					scenario: 'Reviewer disputed whether the original requires preserving completed uploads.',
					consequence: 'An incorrect interpretation could add an unwanted behavior.',
					missingObligation: 'Check the exact preserved original.',
					severity: PlanningVocabulary.Severity.Blocking,
					owner: PlanningVocabulary.Owner.Planner,
					state: PlanningVocabulary.FindingState.Open,
					resolutionClaimIds: [],
					resolutionArtifacts: [],
					verificationReceiptIds: [],
					citations,
				};
				return {
					...response,
					findings: [finding],
					adjudicationRequests: [
						{
							findingIds: [finding.id],
							reason: PlanningVocabulary.Dispute.ConflictingReports,
							explanation: 'Resolve the disputed interpretation against the original wording.',
							citations,
						},
					],
				};
			}
			if (response.role === PlanningVocabulary.Role.Adjudicate && response.kind === PlanningVocabulary.ResultKind.Terminal)
				return {
					...response,
					dispositions: response.dispositions.map((disposition) => ({
						...disposition,
						outcome: PlanningVocabulary.Disposition.Withdraw,
						reason: 'The original explicitly preserves completed uploads, so the objection is mistaken.',
					})),
				};
			return response;
		},
	});
	expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
	const snapshot = await fixture.current();
	const finding = snapshot.record.findings.find((item) => item.scenario.startsWith('Reviewer disputed'));
	const settlementPath = [...snapshot.artifacts.keys()].find((path) => path.startsWith('planning-settlements/'));
	if (!finding || !settlementPath) throw new Error('Expected actual accepted evidenced withdrawal');
	const settlement = JSON.parse(snapshot.artifacts.get(settlementPath) ?? 'null');
	const resultPath = `planning-results/${sha256({ content: settlement.resultReceiptId })}.json`;
	const invocationPath = `planning-invocations/${sha256({ content: settlement.invocationId })}.json`;
	return { ...fixture, snapshot, finding, settlementPath, resultPath, invocationPath };
};

const replaceProof = ({ snapshot, path, patch }: { snapshot: PlanningSnapshot; path: string; patch: Record<string, unknown> }): PlanningSnapshot => {
	const original = snapshot.artifacts.get(path);
	if (!original) throw new Error(`Expected actual proof ${path}`);
	const value: Record<string, unknown> = JSON.parse(original);
	const content = canonicalJson({ value: { ...value, ...patch } });
	return {
		...snapshot,
		artifacts: new Map([...snapshot.artifacts, [path, content]]),
		record: {
			...snapshot.record,
			artifacts: snapshot.record.artifacts.map((artifact) => (artifact.path === path ? { ...artifact, sha256: sha256({ content }) } : artifact)),
		},
	};
};

test('retains a disputed observation and closes it only with its actual independent adjudication', async () => {
	const { snapshot, finding } = await setup();
	expect(finding.state).toBe(PlanningVocabulary.FindingState.Withdrawn);
	expect(finding.observationIds).toHaveLength(1);
	expect(planningFindingSettlement({ snapshot, finding, reviews: getCurrentPlanningReviews({ snapshot }) })).toBe(true);
	expect(snapshot.record.work.filter((work) => work.role === PlanningVocabulary.Role.Adjudicate)).toHaveLength(1);
	expect(snapshot.record.work.some((work) => work.role === PlanningVocabulary.Role.Repair)).toBe(false);
}, 60_000);

test('rejects mismatched withdrawal authority even when individual proof bytes have matching checksums', async () => {
	const { snapshot, finding, settlementPath, resultPath, invocationPath } = await setup();
	const cases: Array<{ label: string; path: string; patch: Record<string, unknown> }> = [
		{ label: 'settlement under another attempt address', path: settlementPath, patch: { attemptId: 'another' } },
		{ label: 'different finding', path: settlementPath, patch: { findingId: 'another' } },
		{ label: 'changed resolution', path: settlementPath, patch: { reason: 'A different resolution' } },
		{ label: 'missing result identity', path: settlementPath, patch: { resultReceiptId: 'result:missing' } },
		{ label: 'missing invocation', path: settlementPath, patch: { invocationId: 'missing' } },
		{ label: 'different accepted owner', path: resultPath, patch: { workId: 'another' } },
		{ label: 'different accepted attempt', path: resultPath, patch: { attemptId: 'another' } },
		{ label: 'wrong accepted role', path: resultPath, patch: { role: PlanningVocabulary.Role.Architect } },
		{ label: 'unaccepted revision', path: resultPath, patch: { acceptedRevision: 0 } },
		{ label: 'future accepted revision', path: resultPath, patch: { acceptedRevision: snapshot.record.revision + 1 } },
		{ label: 'different invocation identity', path: invocationPath, patch: { id: 'another' } },
		{ label: 'different invocation owner', path: invocationPath, patch: { workId: 'another' } },
		{ label: 'different invocation attempt', path: invocationPath, patch: { attemptId: 'another' } },
		{ label: 'different invocation role', path: invocationPath, patch: { role: PlanningVocabulary.Role.Architect } },
		{ label: 'different invocation input', path: invocationPath, patch: { inputDigest: 'a'.repeat(64) } },
		{ label: 'different observed dependencies', path: settlementPath, patch: { dependencies: [] } },
		{ label: 'unobserved citation', path: settlementPath, patch: { citations: [{ artifact: 'unobserved.ts', sha256: 'a'.repeat(64), quote: 'unobserved' }] } },
		{ label: 'changed citation hash', path: settlementPath, patch: { citations: [{ ...finding.citations[0], sha256: 'a'.repeat(64) }] } },
		{ label: 'absent citation quote', path: settlementPath, patch: { citations: [{ ...finding.citations[0], quote: 'this was never in the original' }] } },
	];
	for (const item of cases) {
		const current = replaceProof({ snapshot, path: item.path, patch: item.patch });
		expect({ label: item.label, settled: planningFindingSettlement({ snapshot: current, finding, reviews: [] }) }).toStrictEqual({
			label: item.label,
			settled: false,
		});
	}
	for (const path of [settlementPath, resultPath, invocationPath]) {
		const artifacts = new Map(snapshot.artifacts);
		artifacts.delete(path);
		expect(planningFindingSettlement({ snapshot: { ...snapshot, artifacts }, finding, reviews: [] })).toBe(false);
	}
}, 60_000);
