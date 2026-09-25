import { describe, expect, test } from '@jest/globals';
import type { GradeDecisionLog } from '#src/contracts/plan/memory/GradeDecisionLog.ts';
import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import { getCoverageSeeds } from '#src/plan/internal/common/scope/getCoverageSeeds.ts';

type DecisionEntry = GradeDecisionLog['rows'][number];

/** Every implementable plan file the fixture deliverable holds now — the overview is never among them. */
const phaseFiles = ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'];

/** One merged decision row's fingerprint entry. A row given no `phases` is one that declares no reach. */
const row = ({ id, phases }: { id: string; phases?: string[] }): DecisionEntry => ({
	sha256: `row-${id}`,
	questionSha256: `question-${id}`,
	...(phases === undefined ? {} : { phases }),
});

/**
 * One pass's fingerprint, with every input the same value on both sides so only
 * the decision rows and the moved plan files a test names can move the answer.
 */
const inputsWith = ({ rows, moved = [] }: { rows: DecisionEntry[]; moved?: string[] }): GradeInputs => ({
	planFiles: [
		{ file: 'overview.md', sha256: 'overview-a', designSha256: 'overview-a-design' },
		...phaseFiles.map((file) => ({ file, sha256: `${file}-a`, designSha256: moved.includes(file) ? `${file}-b-design` : `${file}-a-design` })),
	],
	gradedCommit: 'commit-a',
	changedFiles: [{ path: 'src/core.ts', sha256: 'code-a' }],
	standards: 'standards-a',
	config: 'config-a',
	prompts: 'prompts-a',
	model: 'model-a',
	effort: 'high',
	decisionLog: { overviewDesign: 'shared-a', rows },
	sha256: 'combined-a',
});

/**
 * A phased plan's two passes. An absent `previousRows` is a pass with no
 * baseline fingerprint on record at all, and `movedPhases` names the plan files
 * whose design text changed since it.
 */
const setupSeeds = ({
	previousRows,
	currentRows = [],
	movedPhases = [],
}: {
	previousRows?: DecisionEntry[];
	currentRows?: DecisionEntry[];
	movedPhases?: string[];
} = {}) => ({
	inputs: inputsWith({ rows: currentRows, moved: movedPhases }),
	...(previousRows === undefined ? {} : { previous: inputsWith({ rows: previousRows }) }),
	overviewText: '# Overview\n',
	phaseFiles,
});

/**
 * A single plan's two passes: one plan file, and no overview text at all, so
 * there is no Decision Log part to compare and the edited files stand alone.
 */
const setupSinglePlanSeeds = () => {
	const fingerprintWith = ({ designSha256 }: { designSha256: string }): GradeInputs => ({
		planFiles: [{ file: 'plan.md', sha256: 'plan-a', designSha256 }],
		gradedCommit: 'commit-a',
		changedFiles: [{ path: 'src/core.ts', sha256: 'code-a' }],
		standards: 'standards-a',
		config: 'config-a',
		prompts: 'prompts-a',
		model: 'model-a',
		effort: 'high',
		sha256: 'combined-a',
	});

	return {
		inputs: fingerprintWith({ designSha256: 'plan-b-design' }),
		previous: fingerprintWith({ designSha256: 'plan-a-design' }),
		phaseFiles: ['plan.md'],
	};
};

describe('getCoverageSeeds', () => {
	test('a pass with no baseline seeds every plan file', () => {
		const params = setupSeeds();

		const seeded = getCoverageSeeds(params);

		// a pass with no earlier fingerprint has read nothing, so nothing may be held back
		expect(seeded).toStrictEqual({ seeds: ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'] });
	});

	test('a reach that cannot be placed comes back as an error, never as a narrower answer', () => {
		const params = setupSeeds({
			previousRows: [row({ id: 'a', phases: ['phase1-core.md'] })],
			currentRows: [row({ id: 'a', phases: ['phase1-core.md'] }), row({ id: 'b' })],
		});

		const seeded = getCoverageSeeds(params);

		// the added row names no phases, so it may reach the whole plan and the caller widens
		expect(seeded).toStrictEqual({ error: expect.any(String) });
	});

	test('an edited phase and the phases a changed decision row names are seeded together', () => {
		// phase2's design text moved, and a decision row added since the last pass
		// names phase3 — which no reader would otherwise be sent back to
		const params = setupSeeds({
			previousRows: [row({ id: 'a', phases: ['phase1-core.md'] })],
			currentRows: [row({ id: 'a', phases: ['phase1-core.md'] }), row({ id: 'b', phases: ['phase3-final.md'] })],
			movedPhases: ['phase2-extra.md'],
		});

		const seeded = getCoverageSeeds(params);

		// a decision change that moves no plan text still forces the reading it needs,
		// and the phase whose own text moved is not dropped to make room for it
		expect(seeded).toStrictEqual({ seeds: ['phase2-extra.md', 'phase3-final.md'] });
	});

	test('a single plan seeds its edited files alone, with no decision reach to place', () => {
		const params = setupSinglePlanSeeds();

		const seeded = getCoverageSeeds(params);

		// a single plan has no overview and so no Decision Log part to compare: its
		// edited plan file is the whole answer, never an error a caller widens on
		expect(seeded).toStrictEqual({ seeds: ['plan.md'] });
	});
});
