import { describe, expect, test } from '@jest/globals';
import { SourceEvidenceEntry } from '#src/contracts/plan/evidence/SourceEvidenceEntry.ts';

const setupEntry = (overrides: Record<string, unknown> = {}) => {
	const entry = {
		path: 'packages/engine/src/plan/runPlanDraft.ts',
		sha256: 'a'.repeat(64),
		kind: 'whole',
		...overrides,
	};

	return { entry };
};

describe('SourceEvidenceEntry', () => {
	test('SourceEvidenceEntry: a sparse entry parses with its text and array fields defaulted, and an entry with no path is rejected', () => {
		const { entry } = setupEntry();

		const parsed = SourceEvidenceEntry.parse(entry);

		// an entry written by an earlier run carries only the three fields that
		// identify it, so the size, the evidence text and both lists have to arrive
		// empty rather than absent — a reader that has to guess at `roles` would
		// report a file the facts never named
		expect(parsed).toStrictEqual({
			path: 'packages/engine/src/plan/runPlanDraft.ts',
			sha256: 'a'.repeat(64),
			kind: 'whole',
			bytes: 0,
			text: '',
			roles: [],
			definitions: [],
		});

		const withoutPath = SourceEvidenceEntry.safeParse(setupEntry({ path: undefined }).entry);

		// the path is the key the whole record is looked up by: a keyless entry
		// would be evidence no assignment could ever be handed
		expect(withoutPath.success).toBe(false);
	});

	test('SourceEvidenceEntry: an unrecognised kind is rejected', () => {
		const { entry } = setupEntry({ kind: 'partial' });

		const result = SourceEvidenceEntry.safeParse(entry);

		// the kind set is closed at whole, definitions and missing — an unknown
		// reduction mode would reach a writer as evidence nothing can say the shape
		// of, and the brief could not state what the text leaves out
		expect(result.success).toBe(false);
	});
});
