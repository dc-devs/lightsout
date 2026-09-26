import { describe, expect, test } from '@jest/globals';
import { getOverviewDesignHashes } from '#src/plan/internal/common/scope/getOverviewDesignHashes.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

type Params = Parameters<typeof getOverviewDesignHashes>[0];

/** One `## Phases` table row, as the draft flow composes it. */
const phaseRow = ({ number, file, scope }: { number: number; file: string; scope: string }) => `| ${number} | \`${file}\` | ${scope} | 1 | 2 |`;

/** One `### Phase <n>` block of `## Phase Declarations`. */
const phaseBlock = ({ number, file, creates }: { number: number; file: string; creates: string }) =>
	`### Phase ${number} — \`${file}\`

- **Creates:** \`${creates}\`
- **Exports:** none
- **Scripts:** none`;

/** An overview carrying the given rows, declaration blocks and shared dependency prose, parsed as a grading pass parses it. */
const parseOverview = ({ rows, blocks, dependencies }: { rows: string[]; blocks: string[]; dependencies: string }) =>
	parsePlan({
		content: `# Demo — Overview

## Context

The engine grades this plan once per pass.

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
${rows.join('\n')}

## Phase Declarations

${blocks.join('\n\n')}

## Cross-Phase Dependencies

${dependencies}
`,
		base: 'overview.md',
	});

interface TwoPhaseSpec {
	/** Phase one's scope cell — the span a `plan draft` sync rewrites. */
	firstScope?: string;
	/** Phase one's `- **Creates:**` bullet — a line of the declarations section. */
	firstCreates?: string;
	/** The `## Cross-Phase Dependencies` paragraph — authored prose no single phase owns. */
	dependencies?: string;
	/** Add a declaration block for a phase file the `## Phases` table has no row for. */
	orphanBlock?: boolean;
}

/** A two-phase overview whose phase files the deliverable has, plus the knobs each edit case turns. */
const setupTwoPhaseOverview = ({
	firstScope = 'the core',
	firstCreates = 'packages/engine/src/core.ts',
	dependencies = '- **Phase 2 depends on Phase 1.** It imports the core the first phase creates.',
	orphanBlock = false,
}: TwoPhaseSpec = {}): Params => {
	const rows = [phaseRow({ number: 1, file: 'phase1-core.md', scope: firstScope }), phaseRow({ number: 2, file: 'phase2-extra.md', scope: 'the extra' })];
	const blocks = [
		phaseBlock({ number: 1, file: 'phase1-core.md', creates: firstCreates }),
		phaseBlock({ number: 2, file: 'phase2-extra.md', creates: 'packages/engine/src/extra.ts' }),
	];
	const orphan = phaseBlock({ number: 3, file: 'phase3-ghost.md', creates: 'packages/engine/src/ghost.ts' });

	return {
		overview: parseOverview({ rows, blocks: orphanBlock ? [...blocks, orphan] : blocks, dependencies }),
		phaseFiles: orphanBlock ? ['phase1-core.md', 'phase2-extra.md', 'phase3-ghost.md'] : ['phase1-core.md', 'phase2-extra.md'],
	};
};

/** An overview declaring exactly `declared` — one row and one block each — beside the phase files the deliverable actually has. */
const setupMismatchedOverview = ({ declared, phaseFiles }: { declared: string[]; phaseFiles: string[] }): Params => ({
	overview: parseOverview({
		rows: declared.map((file, index) => phaseRow({ number: index + 1, file, scope: 'some work' })),
		blocks: declared.map((file, index) => phaseBlock({ number: index + 1, file, creates: `packages/engine/src/step${index + 1}.ts` })),
		dependencies: '- None.',
	}),
	phaseFiles,
});

/**
 * The split of an overview every span could be placed in. An error member means
 * the case under test did not hold, so it is thrown rather than read as two
 * absent texts that would compare equal to each other.
 */
const splitOf = (params: Params) => {
	const result = getOverviewDesignHashes(params);

	if ('error' in result) {
		throw new Error(`expected every overview span to be placed, got: ${result.error}`);
	}

	return result;
};

/** Each phase's credited overview text as its non-blank lines, so a blank line a span's range carries is no part of the claim. */
const creditedLines = ({ attributed }: { attributed: Map<string, string> }) =>
	Object.fromEntries([...attributed].map(([file, text]) => [file, text.split('\n').filter((line) => line.trim() !== '')]));

describe('getOverviewDesignHashes', () => {
	test('each phase is credited with its own row and its own declaration block and with no other overview text', () => {
		const params = setupTwoPhaseOverview();

		const split = splitOf(params);

		// the row and the block describe one phase alone; `## Cross-Phase
		// Dependencies` and the overview's prose are text every phase shares
		expect(creditedLines(split)).toStrictEqual({
			'phase1-core.md': [
				'| 1 | `phase1-core.md` | the core | 1 | 2 |',
				'### Phase 1 — `phase1-core.md`',
				'- **Creates:** `packages/engine/src/core.ts`',
				'- **Exports:** none',
				'- **Scripts:** none',
			],
			'phase2-extra.md': [
				'| 2 | `phase2-extra.md` | the extra | 1 | 2 |',
				'### Phase 2 — `phase2-extra.md`',
				'- **Creates:** `packages/engine/src/extra.ts`',
				'- **Exports:** none',
				'- **Scripts:** none',
			],
		});
	});

	test("an edit to one phase's row leaves the shared hash and the other phase's attributed text unmoved", () => {
		const before = setupTwoPhaseOverview();
		const after = setupTwoPhaseOverview({ firstScope: 'the core and the registry it reads' });

		const [first, second] = [splitOf(before), splitOf(after)];

		// a sync rewriting one row used to move the whole overview hash, which is
		// what widened every following pass to the whole plan
		expect({
			shared: second.shared === first.shared,
			phaseOne: second.attributed.get('phase1-core.md') === first.attributed.get('phase1-core.md'),
			phaseTwo: second.attributed.get('phase2-extra.md') === first.attributed.get('phase2-extra.md'),
		}).toStrictEqual({ shared: true, phaseOne: false, phaseTwo: true });
	});

	test("an edit to shared overview prose moves the shared hash and no phase's attributed text", () => {
		const before = setupTwoPhaseOverview();
		const after = setupTwoPhaseOverview({ dependencies: '- **Phase 2 depends on Phase 1.** It imports the core and the registry beside it.' });

		const [first, second] = [splitOf(before), splitOf(after)];

		expect({
			shared: second.shared === first.shared,
			phaseOne: second.attributed.get('phase1-core.md') === first.attributed.get('phase1-core.md'),
			phaseTwo: second.attributed.get('phase2-extra.md') === first.attributed.get('phase2-extra.md'),
		}).toStrictEqual({ shared: false, phaseOne: true, phaseTwo: true });
	});

	test('an orphan declaration block returns an error whose shared hash still measures both per-phase sections', () => {
		const base = setupTwoPhaseOverview({ orphanBlock: true });
		const rowEdited = setupTwoPhaseOverview({ orphanBlock: true, firstScope: 'the core and the registry it reads' });
		const blockEdited = setupTwoPhaseOverview({ orphanBlock: true, firstCreates: 'packages/engine/src/registry.ts' });

		const [result, afterRowEdit, afterBlockEdit] = [getOverviewDesignHashes(base), getOverviewDesignHashes(rowEdited), getOverviewDesignHashes(blockEdited)];

		// a span the engine cannot place makes the whole overview shared, so every
		// line of both per-phase sections stays measured rather than going unseen
		expect({
			result,
			rowMoved: afterRowEdit.shared !== result.shared,
			blockMoved: afterBlockEdit.shared !== result.shared,
		}).toEqual({ result: { error: expect.any(String), shared: expect.any(String) }, rowMoved: true, blockMoved: true });
	});

	test.each([
		{ declared: ['phase1-core.md', 'phase9-ghost.md'], phaseFiles: ['phase1-core.md'], unplaceable: 'phase9-ghost.md' },
		{ declared: ['phase1-core.md'], phaseFiles: ['phase1-core.md', 'phase2-extra.md'], unplaceable: 'phase2-extra.md' },
	])('a row naming no phase file and a phase file with no row each return an error naming it', ({ declared, phaseFiles, unplaceable }) => {
		const params = setupMismatchedOverview({ declared, phaseFiles });

		const result = getOverviewDesignHashes(params);

		// attributing whatever happens to match would credit a phase with a span
		// that is not its own, or leave a span credited to nobody
		expect(result).toEqual({ error: expect.stringContaining(unplaceable), shared: expect.any(String) });
	});
});
