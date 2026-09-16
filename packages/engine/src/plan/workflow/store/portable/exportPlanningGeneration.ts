import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningObservation } from '#src/plan/workflow/common/types/transport/PlanningObservation.ts';
import type { PlanningOmittedObservation } from '#src/plan/workflow/common/types/transport/PlanningOmittedObservation.ts';
import type { PlanningPortableGeneration } from '#src/plan/workflow/common/types/transport/PlanningPortableGeneration.ts';
import { validatePlanningGeneration } from '#src/plan/workflow/store/portable/validatePlanningGeneration.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** Publish one pinned snapshot; source observations remain local while all authority and exact public views travel together. */
export const exportPlanningGeneration = ({ snapshot }: Params): Map<string, string> => {
	const artifacts: PlanningPortableGeneration['artifacts'] = [];
	const omittedObservations: PlanningOmittedObservation[] = [];
	const files = new Map<string, string>();
	for (const descriptor of snapshot.record.artifacts) {
		if (
			descriptor.path.startsWith('planning-observations/') &&
			(descriptor.variant !== PlanningVocabulary.Artifact.Data || descriptor.path !== `planning-observations/${descriptor.sha256}.json`)
		)
			throw new Error('Malformed local observation cannot be exported');
		const content = snapshot.artifacts.get(descriptor.path);
		if (content === undefined) {
			const omitted = snapshot.omittedObservations?.find((item) => item.path === descriptor.path && item.sha256 === descriptor.sha256);
			if (!omitted) throw new Error(`Missing planning artifact for export: ${descriptor.path}`);
			omittedObservations.push(omitted);
		} else {
			if (sha256({ content }) !== descriptor.sha256) throw new Error(`Changed planning artifact for export: ${descriptor.path}`);
			if (descriptor.variant === PlanningVocabulary.Artifact.Data && descriptor.path === `planning-observations/${descriptor.sha256}.json`) {
				const observation = PlanningObservation.parse(JSON.parse(content));
				if (canonicalJson({ value: observation }) !== content) throw new Error('Observation bytes must be canonical before omission');
				const { content: _localSource, ...metadata } = observation;
				omittedObservations.push({ path: descriptor.path, sha256: descriptor.sha256, observation: metadata });
			} else artifacts.push({ path: descriptor.path, content });
			if (descriptor.variant !== PlanningVocabulary.Artifact.Data || descriptor.path === 'planning-standards.json') {
				if (descriptor.path.includes('/')) throw new Error('Portable public views require bare attachment names');
				files.set(descriptor.path, content);
			}
		}
	}
	const text = canonicalJson({
		value: { format: 'planning-generation-v1', generation: snapshot.digest, record: snapshot.record, artifacts, omittedObservations },
	});
	validatePlanningGeneration({ text, expectedDigest: sha256({ content: text }), name: snapshot.record.planName });
	files.set('planning-record.json', text);
	return files;
};
