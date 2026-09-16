import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningPortableGeneration } from '#src/plan/workflow/common/types/transport/PlanningPortableGeneration.ts';
import { validatePlanningArtifactBodies } from '#src/plan/workflow/store/common/validation/validatePlanningArtifactBodies.ts';
import { validatePlanningPortableCitations } from '#src/plan/workflow/store/portable/common/validation/validatePlanningPortableCitations.ts';
import { validatePlanningPortableProofs } from '#src/plan/workflow/store/portable/common/validation/validatePlanningPortableProofs.ts';
import { validatePlanningRecord } from '#src/plan/workflow/store/validatePlanningRecord.ts';

interface Params {
	text: string;
	expectedDigest: string;
	name: string;
}

/** Verify exact portable bytes without rewriting the original generation, acceptance revisions or predecessor identity. */
export const validatePlanningGeneration = ({ text, expectedDigest, name }: Params): PlanningSnapshot => {
	if (sha256({ content: text }) !== expectedDigest) throw new Error('Portable generation differs from its selected marker');
	const portable = PlanningPortableGeneration.parse(JSON.parse(text));
	if (
		canonicalJson({ value: portable }) !== text ||
		portable.record.planName !== name ||
		sha256({ content: canonicalJson({ value: portable.record }) }) !== portable.generation
	)
		throw new Error('Portable planning generation has an invalid identity');
	const validation = validatePlanningRecord({ record: portable.record });
	if (!validation.valid) throw new Error(`Invalid portable planning graph: ${JSON.stringify(validation.issues)}`);
	const artifacts = new Map(portable.artifacts.map((item) => [item.path, item.content]));
	if (portable.artifacts.some((item) => item.path.startsWith('planning-observations/')))
		throw new Error('Portable artifacts cannot include raw local observations');
	const omissions = new Map(portable.omittedObservations.map((item) => [item.path, item]));
	if (
		artifacts.size !== portable.artifacts.length ||
		omissions.size !== portable.omittedObservations.length ||
		artifacts.size + omissions.size !== portable.record.artifacts.length
	)
		throw new Error('Portable artifacts and omissions must form an exact descriptor bijection');
	for (const descriptor of portable.record.artifacts) {
		const content = artifacts.get(descriptor.path);
		const omitted = omissions.get(descriptor.path);
		if (content !== undefined) {
			if (omitted || sha256({ content }) !== descriptor.sha256) throw new Error(`Invalid portable artifact: ${descriptor.path}`);
		} else if (
			!omitted ||
			omitted.sha256 !== descriptor.sha256 ||
			descriptor.path !== `planning-observations/${descriptor.sha256}.json` ||
			descriptor.variant !== PlanningVocabulary.Artifact.Data
		)
			throw new Error(`Missing core planning artifact or unauthorized omission: ${descriptor.path}`);
	}
	const snapshot: PlanningSnapshot = { record: portable.record, digest: portable.generation, artifacts, omittedObservations: portable.omittedObservations };
	validatePlanningArtifactBodies({ record: snapshot.record, artifacts });
	validatePlanningPortableProofs({ snapshot });
	validatePlanningPortableCitations({ snapshot });
	return snapshot;
};
