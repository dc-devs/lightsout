import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkAcceptanceLedger } from '#src/plan/lint/checkAcceptanceLedger.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/**
 * A plan creating one source file, with the ledger rows and the change section
 * the case gives it.
 *
 * The ledger sits first so a row's line number does not move when a case adds a
 * change heading: the first row is always line 7 of the plan.
 */
const planFor = ({ rows, changes = '' }: { rows: string[]; changes?: string }) =>
	parsePlan({
		content: `# Plan

## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
${rows.join('\n')}

## Files to Create

### \`src/parse.ts\`

The parser.
${changes}`,
		base: 'plan.md',
	});

/** A `## Files to Modify` or `## Files to Modify from Earlier Phases` section listing one path. */
const changeSection = ({ heading, path }: { heading: string; path: string }) => `\n## ${heading}\n\n### \`${path}\`\n\nChanged.\n`;

/** A `## Files to Move` section moving one file to another. */
const moveSection = ({ from, to }: { from: string; to: string }) => `\n## Files to Move\n\n### \`${from}\` → \`${to}\`\n\nRenamed.\n`;

/** The plan, a repository holding `files`, and the gate keys the config declares. */
const setupMoves = ({
	rows,
	changes,
	files = {},
	gates = ['check', 'test'],
}: {
	rows: string[];
	changes?: string;
	files?: Record<string, string>;
	gates?: string[];
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ledger-moves-'));

	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), text);
	}

	return { plan: planFor({ rows, changes }), cwd, gateKeys: new Set(gates) };
};

describe('checkAcceptanceLedger', () => {
	test('accepts a ledger row naming a test file the plan also lists under Files to Modify, because the reviewer judges that edit', async () => {
		const { plan, cwd, gateKeys } = setupMoves({
			rows: ['| the parser reads a row | `src/parse.unit.test.ts` | reads a row | test |'],
			changes: changeSection({ heading: 'Files to Modify', path: 'src/parse.unit.test.ts' }),
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		expect(findings).toStrictEqual([]);
	});

	test('accepts a ledger row naming a test file listed under Files to Modify from Earlier Phases', async () => {
		const { plan, cwd, gateKeys } = setupMoves({
			rows: ['| the parser reads a row | `src/parse.unit.test.ts` | reads a row | test |'],
			changes: changeSection({ heading: 'Files to Modify from Earlier Phases', path: 'src/parse.unit.test.ts' }),
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		expect(findings).toStrictEqual([]);
	});

	test('accepts a ledger row naming the destination of a move, where the test lives after the plan runs', async () => {
		const { plan, cwd, gateKeys } = setupMoves({
			rows: ['| the parser reads a row | `src/parse.unit.test.ts` | reads a row | test |'],
			changes: moveSection({ from: 'src/old.unit.test.ts', to: 'src/parse.unit.test.ts' }),
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		expect(findings).toStrictEqual([]);
	});

	test('refuses a ledger row naming a move destination whose source already states that test, naming both files', async () => {
		const { plan, cwd, gateKeys } = setupMoves({
			rows: ['| the parser reads a row | `src/parse.unit.test.ts` | reads a row | test |'],
			changes: moveSection({ from: 'src/old.unit.test.ts', to: 'src/parse.unit.test.ts' }),
			files: { 'src/old.unit.test.ts': "test('reads a row', () => {});\n" },
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		// the destination does not exist yet, so the rule reads the move's source —
		// and the finding names both, or the reader cannot see what was judged
		expect(findings).toEqual([
			expect.objectContaining({
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				phase: 'plan.md',
				location: 'plan.md:7',
				issue: expect.stringMatching(/reads a row[\s\S]*src\/parse\.unit\.test\.ts/),
			}),
		]);
		expect(findings[0]?.issue).toEqual(expect.stringContaining('src/old.unit.test.ts'));
	});

	test('refuses a ledger row naming a file the plan moves away, because that file does not survive the plan', async () => {
		const { plan, cwd, gateKeys } = setupMoves({
			rows: ['| the parser reads a row | `src/parse.unit.test.ts` | reads a row | test |'],
			changes: moveSection({ from: 'src/parse.unit.test.ts', to: 'src/renamed.unit.test.ts' }),
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		expect(findings).toEqual([
			expect.objectContaining({
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				phase: 'plan.md',
				location: 'plan.md:7',
				issue: expect.stringContaining('src/parse.unit.test.ts'),
			}),
		]);
	});

	test('reports a moved-away ledger file once however many rows name it', async () => {
		const { plan, cwd, gateKeys } = setupMoves({
			rows: [
				'| one | `src/parse.unit.test.ts` | reads a row | test |',
				'| two | `src/parse.unit.test.ts` | reads a second row | test |',
				'| three | `src/parse.unit.test.ts` | reads a third row | test |',
			],
			changes: moveSection({ from: 'src/parse.unit.test.ts', to: 'src/renamed.unit.test.ts' }),
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		// one vanished file is one mistake: three copies of the same sentence bury
		// every other finding beside them
		expect(findings).toEqual([
			expect.objectContaining({
				check: StructuralCheck.LedgerWellFormed,
				location: 'plan.md:7',
				issue: expect.stringContaining('src/parse.unit.test.ts'),
			}),
		]);
	});
});
