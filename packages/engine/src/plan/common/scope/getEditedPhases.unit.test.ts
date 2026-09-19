import { describe, expect, test } from '@jest/globals';
import type { GradeInputs } from '#src/contracts/index.ts';
import { getEditedPhases } from '#src/plan/common/scope/getEditedPhases.ts';

interface InputsSpec {
	planFiles?: GradeInputs['planFiles'];
	/** Left out of the fingerprint entirely, the way a git probe that did not run leaves it. */
	omitChangedFiles?: boolean;
}

/** One fingerprint whose non-plan inputs are all the same value, so only what a test varies can move the answer. */
const inputsWith = ({ planFiles = [], omitChangedFiles = false }: InputsSpec): GradeInputs => ({
	planFiles,
	gradedCommit: 'commit-a',
	...(omitChangedFiles ? {} : { changedFiles: [{ path: 'src/core.ts', sha256: 'code-a' }] }),
	standards: 'standards-a',
	config: 'config-a',
	prompts: 'prompts-a',
	model: 'model-a',
	effort: 'high',
	sha256: 'combined-a',
});

/** One plan file's two hashes, its design hash derived from its whole-file hash — so a fixture that moves a file moves the text a reader read with it. */
const entryFor = ({ file, content }: { file: string; content: string }) => ({ file, sha256: content, designSha256: `${content}-design` });

/** A three-file phased plan on both sides, with the shas each side gives the overview and the second phase. */
const setupPhaseEdit = ({
	previousOverview,
	currentOverview,
	previousSecond,
	currentSecond,
}: {
	previousOverview: string;
	currentOverview: string;
	previousSecond: string;
	currentSecond: string;
}) => {
	const previous = inputsWith({
		planFiles: [
			entryFor({ file: 'overview.md', content: previousOverview }),
			entryFor({ file: 'phase1-core.md', content: 'phase1-a' }),
			entryFor({ file: 'phase2-extra.md', content: previousSecond }),
		],
	});
	const current = inputsWith({
		planFiles: [
			entryFor({ file: 'overview.md', content: currentOverview }),
			entryFor({ file: 'phase1-core.md', content: 'phase1-a' }),
			entryFor({ file: 'phase2-extra.md', content: currentSecond }),
		],
	});

	return { previous, current };
};

/** The two fingerprints a probe row compares, each side either carrying its changed-file list or missing it. */
const setupProbe = ({ currentAbsent, previousAbsent }: { currentAbsent: boolean; previousAbsent: boolean }) => {
	const planFiles = [entryFor({ file: 'plan.md', content: 'plan-a' })];
	const previous = inputsWith({ planFiles, omitChangedFiles: previousAbsent });
	const current = inputsWith({ planFiles, omitChangedFiles: currentAbsent });

	return { previous, current };
};

/** The two fingerprints a moved-input row compares: identical plan text, and exactly one non-plan input given a different value. */
const setupInputMove = ({ moved }: { moved: Partial<GradeInputs> }) => {
	const planFiles = [entryFor({ file: 'plan.md', content: 'plan-a' })];
	const previous = inputsWith({ planFiles });
	const current = { ...inputsWith({ planFiles }), ...moved };

	return { previous, current };
};

/** A phase the previous pass never measured, beside one both passes hashed the same way. */
const setupAddedPhase = () => {
	const previous = inputsWith({ planFiles: [entryFor({ file: 'phase1-core.md', content: 'phase1-a' })] });
	const current = inputsWith({
		planFiles: [entryFor({ file: 'phase1-core.md', content: 'phase1-a' }), entryFor({ file: 'phase2-extra.md', content: 'phase2-a' })],
	});

	return { previous, current };
};

/** One plan-file entry as a fingerprint carries it: its whole-file hash, and its design hash when one was measured. */
type Entry = { sha256: string; designSha256?: string };

/** A two-file phased plan on both sides, where each side states its own whole-file and design hashes for the overview and the phase. */
const setupDesignHashes = ({
	previousOverview,
	currentOverview,
	previousPhase,
	currentPhase,
}: {
	previousOverview: Entry;
	currentOverview: Entry;
	previousPhase: Entry;
	currentPhase: Entry;
}) => {
	const previous = inputsWith({
		planFiles: [
			{ file: 'overview.md', ...previousOverview },
			{ file: 'phase1-core.md', ...previousPhase },
		],
	});
	const current = inputsWith({
		planFiles: [
			{ file: 'overview.md', ...currentOverview },
			{ file: 'phase1-core.md', ...currentPhase },
		],
	});

	return { previous, current };
};

describe('getEditedPhases', () => {
	test('edited phases exclude the overview, which is reported on its own', () => {
		const { previous, current } = setupPhaseEdit({
			previousOverview: 'overview-a',
			currentOverview: 'overview-b',
			previousSecond: 'phase2-a',
			currentSecond: 'phase2-b',
		});

		const edits = getEditedPhases({ current, previous });

		// the overview arriving in `edited` would send the closure walk looking for a
		// phase named overview.md, and an unchanged phase arriving there would widen
		// a focused pass back to the whole plan
		expect(edits).toStrictEqual({ edited: ['phase2-extra.md'], overviewFileChanged: true, otherInputChanged: false });
	});

	test.each([
		{ currentAbsent: true, previousAbsent: false },
		{ currentAbsent: false, previousAbsent: true },
		{ currentAbsent: true, previousAbsent: true },
	])('an absent changed-file list counts as a changed input on either side', ({ currentAbsent, previousAbsent }) => {
		const { previous, current } = setupProbe({ currentAbsent, previousAbsent });

		const edits = getEditedPhases({ current, previous });

		// an unread probe read as "no code changed" would let a focused pass narrow
		// against a code state nobody measured
		expect(edits).toStrictEqual({ edited: [], overviewFileChanged: false, otherInputChanged: true });
	});

	test.each<{ label: string; moved: Partial<GradeInputs> }>([
		{ label: 'commit', moved: { gradedCommit: 'commit-b' } },
		{ label: 'working tree', moved: { changedFiles: [{ path: 'src/core.ts', sha256: 'code-b' }] } },
		{ label: 'standards', moved: { standards: 'standards-b' } },
		{ label: 'configuration', moved: { config: 'config-b' } },
		{ label: 'prompts', moved: { prompts: 'prompts-b' } },
		{ label: 'model', moved: { model: 'model-b' } },
		{ label: 'effort', moved: { effort: 'max' } },
	])('a moved $label is reported as a changed input', ({ moved }) => {
		const { previous, current } = setupInputMove({ moved });

		const edits = getEditedPhases({ current, previous });

		// the recorded reading no longer speaks for this pass, so no closure of
		// edited phases may bound it
		expect(edits).toStrictEqual({ edited: [], overviewFileChanged: false, otherInputChanged: true });
	});

	test('a plan file present on one side only reads as edited', () => {
		const { previous, current } = setupAddedPhase();

		const edits = getEditedPhases({ current, previous });

		// a resplit that added a phase leaves it with no recorded hash at all, and a
		// phase nobody has read must seed the closure rather than be skipped
		expect(edits).toStrictEqual({ edited: ['phase2-extra.md'], overviewFileChanged: false, otherInputChanged: false });
	});

	test("the overview's whole-file move is reported without any phase being called edited", () => {
		const { previous, current } = setupDesignHashes({
			previousOverview: { sha256: 'overview-file-a', designSha256: 'overview-design-a' },
			currentOverview: { sha256: 'overview-file-b', designSha256: 'overview-design-a' },
			previousPhase: { sha256: 'phase1-file-a', designSha256: 'phase1-design-a' },
			currentPhase: { sha256: 'phase1-file-a', designSha256: 'phase1-design-a' },
		});

		const edits = getEditedPhases({ current, previous });

		// the overview's file move is what `getDecisionReach` reads, and it is a
		// different fact from its design moving, so it may not pull a phase into `edited`
		expect(edits).toStrictEqual({ edited: [], overviewFileChanged: true, otherInputChanged: false });
	});

	test('a plan file with a design hash on one side only is reported as edited', () => {
		const { previous, current } = setupDesignHashes({
			previousOverview: { sha256: 'overview-file-a', designSha256: 'overview-design-a' },
			currentOverview: { sha256: 'overview-file-a', designSha256: 'overview-design-a' },
			previousPhase: { sha256: 'phase1-file-a' },
			currentPhase: { sha256: 'phase1-file-a', designSha256: 'phase1-design-a' },
		});

		const edits = getEditedPhases({ current, previous });

		// a fingerprint recorded before design hashes existed measured no design at
		// all, which is not evidence that the design is unchanged
		expect(edits).toStrictEqual({ edited: ['phase1-core.md'], overviewFileChanged: false, otherInputChanged: false });
	});

	test('a phase whose generated regions alone were rewritten is not reported as edited', () => {
		const { previous, current } = setupDesignHashes({
			previousOverview: { sha256: 'overview-file-a', designSha256: 'overview-design-a' },
			currentOverview: { sha256: 'overview-file-a', designSha256: 'overview-design-a' },
			previousPhase: { sha256: 'phase1-file-a', designSha256: 'phase1-design-a' },
			currentPhase: { sha256: 'phase1-file-b', designSha256: 'phase1-design-a' },
		});

		const edits = getEditedPhases({ current, previous });

		// only engine-generated text moved, so the design a reader read is unchanged
		// and the pass must not widen to this phase
		expect(edits).toStrictEqual({ edited: [], overviewFileChanged: false, otherInputChanged: false });
	});
});
