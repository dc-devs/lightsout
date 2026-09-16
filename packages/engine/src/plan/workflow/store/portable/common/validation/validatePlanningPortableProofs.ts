import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningStandardsBundle } from '#src/contracts/index.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/invocation/PlanningBaseline.ts';
import { PlanningInvocation } from '#src/plan/workflow/common/types/invocation/PlanningInvocation.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningProof } from '#src/plan/workflow/common/utils/proofs/readPlanningProof.ts';
import { readPlanningResultReceipts } from '#src/plan/workflow/store/common/validation/readPlanningResultReceipts.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** An anchor cannot replay predecessors; it must retain actual invocation and acceptance proofs at their original revisions. */
export const validatePlanningPortableProofs = ({ snapshot }: Params): void => {
	for (const source of snapshot.record.sources)
		if (snapshot.artifacts.get(`planning-originals/${source.sha256}.txt`) !== source.text)
			throw new Error('Portable planning generation is missing a complete original');
	const standards = snapshot.artifacts.get('planning-standards.json');
	if (standards !== undefined) {
		const bundle = PlanningStandardsBundle.parse(JSON.parse(standards));
		const descriptors = bundle.channels.map(({ text: _text, ...channel }) => ({ ...channel, artifact: 'planning-standards.json' }));
		if (canonicalJson({ value: descriptors }) !== canonicalJson({ value: snapshot.record.standards }))
			throw new Error('Portable standards descriptors differ from their full channels');
	}
	const invocations = snapshot.record.artifacts
		.filter((item) => item.path.startsWith('planning-invocations/'))
		.map((item) => {
			const invocation = readPlanningProof({ snapshot, path: item.path, schema: PlanningInvocation });
			if (!invocation || item.path !== `planning-invocations/${sha256({ content: invocation.id })}.json`)
				throw new Error('Portable invocation proof is missing or corrupt');
			for (const path of invocation.observationPaths)
				if (!snapshot.record.artifacts.some((artifact) => artifact.path === path)) throw new Error('Portable invocation lost its observation descriptor');
			return invocation;
		});
	const results = readPlanningResultReceipts({ record: snapshot.record, artifacts: snapshot.artifacts });
	for (const result of results.values()) {
		const baseline = readPlanningProof({ snapshot, path: `planning-baselines/${sha256({ content: result.id })}.json`, schema: PlanningBaseline });
		if (
			!baseline ||
			baseline.workId !== result.workId ||
			baseline.attemptId !== result.attemptId ||
			baseline.resultReceiptId !== result.id ||
			baseline.acceptedRevision !== result.acceptedRevision
		)
			throw new Error('Portable result lacks its original accepted baseline');
		if (
			!invocations.some(
				(invocation) =>
					invocation.workId === result.workId &&
					invocation.attemptId === result.attemptId &&
					invocation.role === result.role &&
					invocation.inputDigest === result.inputDigest &&
					canonicalJson({ value: invocation.observationPaths }) === canonicalJson({ value: baseline.observationPaths }) &&
					invocation.invocationPolicyDigest === baseline.invocationPolicyDigest &&
					invocation.executionPolicyDigest === baseline.executionPolicyDigest,
			)
		)
			throw new Error('Portable result lacks its actual invocation');
	}
	for (const review of snapshot.record.reviewReceipts)
		if (
			!invocations.some(
				(invocation) =>
					invocation.id === review.issuer.invocationId &&
					invocation.workId === review.workId &&
					invocation.attemptId === review.attemptId &&
					invocation.role === review.role &&
					invocation.inputDigest === review.inputDigest &&
					canonicalJson({ value: invocation.dependencies }) === canonicalJson({ value: review.dependencies }),
			)
		)
			throw new Error('Portable review lacks its actual independent invocation');
};
