import { describe, expect, test } from '@jest/globals';
import { SourceEvidenceIndex } from '#src/contracts/index.ts';

const setupIndex = () => {
	const collected = {
		planName: 'focused-plan-drafting',
		entries: [
			{
				path: 'packages/engine/src/plan/runPlanDraft.ts',
				sha256: 'a'.repeat(64),
				kind: 'whole',
				bytes: 812,
				text: 'export const runPlanDraft = () => {};\n',
				roles: ['the dispatcher the focused flow is selected from'],
				definitions: [],
			},
			{
				path: 'packages/engine/src/plan/detectPriorArtCandidates.ts',
				sha256: 'b'.repeat(64),
				kind: 'definitions',
				bytes: 19004,
				text: 'export const detectPriorArtCandidates = async () => [];\n',
				roles: ['the census this phase extracts', 'integration point: detectPriorArtCandidates'],
				definitions: ['detectPriorArtCandidates'],
			},
		],
		collectedAt: '2026-09-13T00:00:00.000Z',
	};
	const fresh = {
		planName: 'focused-plan-drafting',
		collectedAt: '2026-09-13T00:00:00.000Z',
	};

	return { collected, fresh };
};

describe('SourceEvidenceIndex', () => {
	test('SourceEvidenceIndex: an index parses with its entries intact, and an index with no entries key defaults to an empty list', () => {
		const { collected, fresh } = setupIndex();

		const parsedCollected = SourceEvidenceIndex.parse(collected);
		const parsedFresh = SourceEvidenceIndex.parse(fresh);

		// every writer reads its evidence back out of this record, so a dropped
		// entry or a dropped field would hand a writer less than was collected;
		// and a record written before anything was collected has to load rather
		// than refuse, so the first collection can fill it in
		expect({ parsedCollected, parsedFresh }).toStrictEqual({
			parsedCollected: {
				planName: 'focused-plan-drafting',
				entries: [
					{
						path: 'packages/engine/src/plan/runPlanDraft.ts',
						sha256: 'a'.repeat(64),
						kind: 'whole',
						bytes: 812,
						text: 'export const runPlanDraft = () => {};\n',
						roles: ['the dispatcher the focused flow is selected from'],
						definitions: [],
					},
					{
						path: 'packages/engine/src/plan/detectPriorArtCandidates.ts',
						sha256: 'b'.repeat(64),
						kind: 'definitions',
						bytes: 19004,
						text: 'export const detectPriorArtCandidates = async () => [];\n',
						roles: ['the census this phase extracts', 'integration point: detectPriorArtCandidates'],
						definitions: ['detectPriorArtCandidates'],
					},
				],
				collectedAt: '2026-09-13T00:00:00.000Z',
			},
			parsedFresh: {
				planName: 'focused-plan-drafting',
				entries: [],
				collectedAt: '2026-09-13T00:00:00.000Z',
			},
		});
	});
});
