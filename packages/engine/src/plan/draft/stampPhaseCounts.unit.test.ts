import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { stampPhaseCounts } from '#src/plan/draft/stampPhaseCounts.ts';
import { type DeclarationSpec, overviewBody, type PhaseSpec, phaseBody } from '#tests/helpers/phasePlan.ts';

// The count stamp: the overview's `## Phases` table is authored before any
// phase file exists, so its Creates and Touches cells are the overview agent's
// estimate. Once the fan-out has written the phase files those counts are a
// fact, and this is what states them — and nothing else.

/** The `## Phases` table's data rows as they stand on disk; the header and separator rows have no integer first cell. */
const rowLines = ({ text }: { text: string }) => text.split('\n').filter((line) => /^\|\s*\d/.test(line));

/** The declaration fields the stamp is supposed to have rewritten. */
const countsOf = ({ declarations }: { declarations: { file: string; createdCount?: number; touchedCount?: number }[] }) =>
	declarations.map(({ file, createdCount, touchedCount }) => ({ file, createdCount, touchedCount }));

/** A plan workspace holding one authored overview and the phase files the fan-out just wrote. */
const setupStamp = ({
	rows,
	phases,
	overview,
}: {
	rows: DeclarationSpec[];
	phases: Record<string, PhaseSpec>;
	overview?: (params: { text: string }) => string;
}) => {
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-stamp-'));
	const overviewPath = join(workspaceDir, 'overview.md');
	const text = overviewBody({ rows });

	writeFileSync(overviewPath, overview ? overview({ text }) : text);

	const phasePaths = Object.entries(phases).map(([base, spec]) => {
		const path = join(workspaceDir, base);

		writeFileSync(path, phaseBody(spec));

		return path;
	});

	return { overviewPath, phasePaths, readOverview: () => readFileSync(overviewPath, 'utf8') };
};

/** The same overview carrying a second table, under a later heading, whose row names a phase file. */
const withLaterTable = ({ text }: { text: string }) => `${text}\n| 1 | \`phase1-core.md\` | hands its exports to phase 2 | n/a | n/a |\n`;

describe('stampPhaseCounts', () => {
	test("a phase's real counts replace the overview's estimate, in the table and in what comes back", async () => {
		const stamp = setupStamp({
			rows: [{ number: 1, file: 'phase1-core.md', created: 9, touched: 9 }],
			phases: { 'phase1-core.md': { create: ['src/a.ts', 'src/b.ts'], modify: ['src/c.ts'] } },
		});

		const declarations = await stampPhaseCounts({ overviewPath: stamp.overviewPath, phasePaths: stamp.phasePaths });

		// the estimate said nine of each; the files say two created and three touched
		expect({ rows: rowLines({ text: stamp.readOverview() }), declared: countsOf({ declarations }) }).toStrictEqual({
			rows: ['| 1 | `phase1-core.md` | the work | 2 | 3 |'],
			declared: [{ file: 'phase1-core.md', createdCount: 2, touchedCount: 3 }],
		});
	});

	test('each row is stamped from the phase file it names, not from its neighbour', async () => {
		const stamp = setupStamp({
			rows: [
				{ number: 1, file: 'phase1-core.md', created: 0, touched: 0 },
				{ number: 2, file: 'phase2-wire.md', created: 0, touched: 0 },
			],
			phases: {
				'phase1-core.md': { create: ['src/one.ts'], modify: ['src/two.ts', 'src/three.ts'] },
				'phase2-wire.md': { create: ['src/four.ts', 'src/five.ts', 'src/six.ts'] },
			},
		});

		const declarations = await stampPhaseCounts({ overviewPath: stamp.overviewPath, phasePaths: stamp.phasePaths });

		expect({ rows: rowLines({ text: stamp.readOverview() }), declared: countsOf({ declarations }) }).toStrictEqual({
			rows: ['| 1 | `phase1-core.md` | the work | 1 | 3 |', '| 2 | `phase2-wire.md` | the work | 3 | 3 |'],
			declared: [
				{ file: 'phase1-core.md', createdCount: 1, touchedCount: 3 },
				{ file: 'phase2-wire.md', createdCount: 3, touchedCount: 3 },
			],
		});
	});

	test.each<{ case: string; spec: PhaseSpec; created: number; touched: number }>([
		{
			case: 'a test file, a barrel and a declaration file, none of which count',
			spec: { create: ['src/a.ts', 'src/a.unit.test.ts', 'src/index.ts', 'src/b.d.ts'] },
			created: 1,
			touched: 1,
		},
		{ case: 'a move, touched on both sides and created by neither', spec: { move: [{ from: 'src/old.ts', to: 'src/new.ts' }] }, created: 0, touched: 2 },
		{ case: 'an earlier-phase modify and a deletion, both touched', spec: { earlierModify: ['src/e.ts'], remove: ['src/d.ts'] }, created: 0, touched: 2 },
		{ case: 'the same path created and modified, counted once', spec: { create: ['src/a.ts'], modify: ['src/a.ts'] }, created: 1, touched: 1 },
	])('the stamped numbers count $case', async ({ spec, created, touched }) => {
		const stamp = setupStamp({ rows: [{ number: 1, file: 'phase1-core.md', created: 99, touched: 99 }], phases: { 'phase1-core.md': spec } });

		const declarations = await stampPhaseCounts({ overviewPath: stamp.overviewPath, phasePaths: stamp.phasePaths });

		expect(countsOf({ declarations })).toStrictEqual([{ file: 'phase1-core.md', createdCount: created, touchedCount: touched }]);
	});

	test('the scope, the declared creates, exports and scripts and the file-budget bullet are left exactly as written', async () => {
		const stamp = setupStamp({
			rows: [
				{
					number: 1,
					file: 'phase1-core.md',
					scope: 'the mechanical rename',
					created: 7,
					touched: 7,
					creates: ['src/kept.ts'],
					exports: ['keptExport'],
					scripts: ['kept:script'],
					fileBudget: 4,
				},
			],
			phases: { 'phase1-core.md': { modify: ['src/m0.ts', 'src/m1.ts', 'src/m2.ts', 'src/m3.ts', 'src/m4.ts', 'src/m5.ts'] } },
		});

		const declarations = await stampPhaseCounts({ overviewPath: stamp.overviewPath, phasePaths: stamp.phasePaths });

		// a budget declares that a phase is MEANT to be large — stamping it would
		// either overwrite the declaration or leave the two copies disagreeing, and
		// the declared creates/exports/scripts are claims the consistency check
		// must still be able to fail
		expect(declarations).toStrictEqual([
			{
				number: 1,
				file: 'phase1-core.md',
				scope: 'the mechanical rename',
				createdCount: 0,
				touchedCount: 6,
				creates: ['src/kept.ts'],
				exports: ['keptExport'],
				scripts: ['kept:script'],
				fileBudget: 4,
			},
		]);
	});

	test('a phase file the overview never lists leaves the table exactly as it stood', async () => {
		const stamp = setupStamp({
			rows: [{ number: 1, file: 'phase1-core.md', created: 5, touched: 5 }],
			phases: { 'phase9-ghost.md': { create: ['src/ghost.ts'] } },
		});

		const declarations = await stampPhaseCounts({ overviewPath: stamp.overviewPath, phasePaths: stamp.phasePaths });

		// only a row the fan-out actually authored a file for becomes a fact; the
		// rest stay the overview agent's estimate
		expect({ rows: rowLines({ text: stamp.readOverview() }), declared: countsOf({ declarations }) }).toStrictEqual({
			rows: ['| 1 | `phase1-core.md` | the work | 5 | 5 |'],
			declared: [{ file: 'phase1-core.md', createdCount: 5, touchedCount: 5 }],
		});
	});

	test('a table row under a later heading is not stamped, even when it names a phase file', async () => {
		const stamp = setupStamp({
			rows: [{ number: 1, file: 'phase1-core.md', created: 0, touched: 0 }],
			phases: { 'phase1-core.md': { create: ['src/a.ts'] } },
			overview: withLaterTable,
		});

		const declarations = await stampPhaseCounts({ overviewPath: stamp.overviewPath, phasePaths: stamp.phasePaths });

		// `## Phases` is the only table the stamp owns; a row elsewhere that
		// happens to name the same file is prose the overview agent wrote
		expect({ rows: rowLines({ text: stamp.readOverview() }), declared: countsOf({ declarations }) }).toStrictEqual({
			rows: ['| 1 | `phase1-core.md` | the work | 1 | 1 |', '| 1 | `phase1-core.md` | hands its exports to phase 2 | n/a | n/a |'],
			declared: [{ file: 'phase1-core.md', createdCount: 1, touchedCount: 1 }],
		});
	});
});
