import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { PlanningRecord } from '#src/contracts/index.ts';

interface Params {
	previous: PlanningRecord;
	record: PlanningRecord;
}

/** Accepted receipts and captured originals remain immutable even when their work is later invalidated. */
export const validatePlanningHistory = ({ previous, record }: Params): void => {
	if (canonicalJson({ value: previous.legacySettlements ?? [] }) !== canonicalJson({ value: record.legacySettlements ?? [] }))
		throw new Error('Historical settlements may only be created by initial import');
	for (const confirmation of previous.confirmations) {
		if (canonicalJson({ value: record.confirmations.find((item) => item.id === confirmation.id) }) !== canonicalJson({ value: confirmation }))
			throw new Error('Original confirmation provenance cannot be changed or deleted');
	}
	for (const receipt of previous.reviewReceipts) {
		if (canonicalJson({ value: record.reviewReceipts.find((item) => item.id === receipt.id) }) !== canonicalJson({ value: receipt }))
			throw new Error('Accepted review receipt cannot be changed or deleted');
	}
	for (const source of previous.sources) {
		if (!record.sources.some((item) => canonicalJson({ value: item }) === canonicalJson({ value: source })))
			throw new Error('Original input provenance cannot be changed or deleted');
	}
	for (const artifact of previous.artifacts.filter(
		(item) =>
			item.path.startsWith('planning-results/') ||
			item.path.startsWith('planning-originals/') ||
			item.path.startsWith('planning-legacy') ||
			[
				'planning-invocations/',
				'planning-observations/',
				'planning-baselines/',
				'planning-questions/',
				'planning-adjudication-requests/',
				'planning-assurance-obligations/',
				'planning-assurances/',
				'planning-settlements/',
				'planning-failures/',
				'planning-structural/',
			].some((prefix) => item.path.startsWith(prefix)),
	)) {
		if (canonicalJson({ value: record.artifacts.find((item) => item.path === artifact.path) }) !== canonicalJson({ value: artifact }))
			throw new Error('Accepted result receipt or captured legacy artifact cannot be changed or deleted');
	}
};
