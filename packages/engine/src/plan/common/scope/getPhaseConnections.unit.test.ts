import { describe, expect, test } from '@jest/globals';
import { getPhaseConnections } from '#src/plan/common/scope/getPhaseConnections.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';

interface PhaseSpec {
	base: string;
	/** `## Files to Create` paths — provided, and named under a heading in the phase's own text. */
	create?: string[];
	/** `## Files to Modify` paths — provided too, even though no phase creates them. */
	modify?: string[];
	/** Backticked spans in the phase's prose: what it reads from elsewhere in the plan. */
	mentions?: string[];
	/** The `## What Next Plan Expects` tokens this phase hands to the next one. */
	handsForward?: string[];
	/** The `- **Exports:**` values the overview declares for this phase — provided, though the phase's own text never names them. */
	exports?: string[];
	/** Set false to leave this phase out of the overview's `## Phase Declarations`. */
	declared?: boolean;
}

/** A parsed plan carrying the two things the graph reads: the paths its headings name, and every backticked span in its text. */
const planWith = ({ base, create = [], modify = [], mentions = [], handsForward = [] }: PhaseSpec): PhaseFile['plan'] => {
	const handoffLines = handsForward.map((token) => `- \`${token}\``);

	return {
		base,
		title: 'Phase',
		variant: 'implementable',
		sections: new Map([['What Next Plan Expects', handoffLines]]),
		createPaths: create,
		modifyPaths: modify,
		earlierPhaseModifyPaths: [],
		deletePaths: [],
		movePaths: [],
		malformedMoveLines: [],
		mirrorPaths: [],
		verificationCommands: [],
		ledger: [],
		malformedLedgerLines: [],
		proseFiles: [],
		malformedProseLines: [],
		lines: [
			...[...create, ...modify].map((path) => `### \`${path}\``),
			...mentions.map((token) => `- this phase builds against \`${token}\``),
			'## What Next Plan Expects',
			...handoffLines,
		],
	};
};

/** The phase files in the order given, plus one overview declaration per phase that declares one. */
const setupPhases = ({ specs }: { specs: PhaseSpec[] }) => {
	const phases = specs.map((spec, index): PhaseFile => ({ path: `/plans/demo/${spec.base}`, base: spec.base, number: index + 1, plan: planWith(spec) }));
	const declarations = specs
		.map((spec, index) => ({ spec, number: index + 1 }))
		.filter(({ spec }) => spec.declared !== false)
		.map(
			({ spec, number }): PhaseDeclaration => ({
				number,
				file: spec.base,
				scope: 'demo phase',
				creates: spec.create ?? [],
				exports: spec.exports ?? [],
				scripts: [],
			}),
		);

	return { phases, declarations };
};

/** The edge map as sorted basename lists, or the error returned in its place — so one assertion states either outcome. */
const edgesOf = ({ result }: { result: ReturnType<typeof getPhaseConnections> }) =>
	'error' in result ? result : Object.fromEntries([...result.connections].map(([base, neighbours]): [string, string[]] => [base, [...neighbours].sort()]));

describe('getPhaseConnections', () => {
	test('a phase is connected to both the phase it consumes from and the phase that consumes from it', () => {
		const { phases, declarations } = setupPhases({
			specs: [
				{ base: 'phase1-contract.md', create: ['src/contract.ts'] },
				{ base: 'phase2-consumer.md', create: ['src/consumer.ts'], mentions: ['src/contract.ts'], handsForward: ['renderWidget'] },
				{ base: 'phase3-renderer.md', create: ['src/renderer.ts'], mentions: ['renderWidget'] },
			],
		});

		const result = getPhaseConnections({ phases, declarations });

		// phase 2 reads phase 1's created file and phase 3 reads phase 2's hand-off:
		// a directed graph would leave phase 1 unaware that a repair to phase 2 reaches it
		expect(edgesOf({ result })).toStrictEqual({
			'phase1-contract.md': ['phase2-consumer.md'],
			'phase2-consumer.md': ['phase1-contract.md', 'phase3-renderer.md'],
			'phase3-renderer.md': ['phase2-consumer.md'],
		});
	});

	test('a phase with no overview declaration is reported as an error rather than an empty edge set', () => {
		const { phases, declarations } = setupPhases({
			specs: [
				{ base: 'phase1-contract.md', create: ['src/contract.ts'] },
				{ base: 'phase2-consumer.md', create: ['src/consumer.ts'], mentions: ['src/contract.ts'], declared: false },
			],
		});

		const result = getPhaseConnections({ phases, declarations });

		// an undeclared phase has no exports to read, so its edges cannot be trusted;
		// returning edges anyway would narrow a re-grade against a graph known to be short
		expect(result).toStrictEqual({ error: expect.stringContaining('phase2-consumer.md') });
	});

	test('two phases naming the same modified file are connected', () => {
		const { phases, declarations } = setupPhases({
			specs: [
				{ base: 'phase1-widen.md', modify: ['src/shared.ts'] },
				{ base: 'phase2-narrow.md', modify: ['src/shared.ts'] },
			],
		});

		const result = getPhaseConnections({ phases, declarations });

		// neither phase creates the file and neither hands it forward, but two edits
		// to one file are coupled whichever phase owns it today
		expect(edgesOf({ result })).toStrictEqual({ 'phase1-widen.md': ['phase2-narrow.md'], 'phase2-narrow.md': ['phase1-widen.md'] });
	});

	test('an overview-declared export connects the phase that consumes it', () => {
		const { phases, declarations } = setupPhases({
			specs: [
				{ base: 'phase1-runner.md', create: ['src/runner.ts'], exports: ['runGradePass'] },
				{ base: 'phase2-caller.md', create: ['src/caller.ts'], mentions: ['runGradePass'] },
			],
		});

		const result = getPhaseConnections({ phases, declarations });

		// the export is declared in the overview, not in the phase's own text, so a
		// graph reading only the phase files would miss the seam entirely
		expect(edgesOf({ result })).toStrictEqual({ 'phase1-runner.md': ['phase2-caller.md'], 'phase2-caller.md': ['phase1-runner.md'] });
	});

	test("the template's declared-absence sentinel joins no phases", () => {
		const { phases, declarations } = setupPhases({
			specs: [
				{ base: 'phase1-solo.md', create: ['src/one.ts'], handsForward: ['none'] },
				{ base: 'phase2-solo.md', create: ['src/two.ts'], mentions: ['none'] },
			],
		});

		const result = getPhaseConnections({ phases, declarations });

		// a declared absence is not a name being handed over; reading it as one
		// would join every phase that declares nothing to every other
		expect(edgesOf({ result })).toStrictEqual({ 'phase1-solo.md': [], 'phase2-solo.md': [] });
	});
});
