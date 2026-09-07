import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkAcceptanceLedger } from '#src/plan/lint/checkAcceptanceLedger.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/**
 * A plan creating one source file, moving the given files away, with the ledger
 * rows the case gives it.
 *
 * The ledger sits first so a row's line number does not move when a case adds a
 * move heading: the first row is always line 7 of the plan.
 */
const planFor = ({ rows, moves }: { rows: string[]; moves: { from: string; to: string }[] }) =>
	parsePlan({
		content: `# Plan

## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
${rows.join('\n')}

## Files to Create

### \`src/parse.ts\`

The parser.

## Files to Move

${moves.map((move) => `### \`${move.from}\` → \`${move.to}\`\n\nRenamed.\n`).join('\n')}`,
		base: 'plan.md',
	});

/** The plan, an empty repository to read rows against, and the gate keys the config declares. */
const setupMovedAway = ({ rows, moves }: { rows: string[]; moves: { from: string; to: string }[] }) => ({
	plan: planFor({ rows, moves }),
	cwd: mkdtempSync(join(tmpdir(), 'lightsout-ledger-coverage-')),
	gateKeys: new Set(['check', 'test']),
});

describe('checkAcceptanceLedger', () => {
	test('reports every moved-away ledger file, so two vanished files are two findings at their own rows', async () => {
		const { plan, cwd, gateKeys } = setupMovedAway({
			rows: [
				'| the parser reads a row | `src/first.unit.test.ts` | reads a row | test |',
				'| the parser writes a row | `src/second.unit.test.ts` | writes a row | test |',
			],
			moves: [
				{ from: 'src/first.unit.test.ts', to: 'src/firstRenamed.unit.test.ts' },
				{ from: 'src/second.unit.test.ts', to: 'src/secondRenamed.unit.test.ts' },
			],
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		// the once-per-file guard is keyed on the file, not on the ledger: silencing
		// the second vanished file would hide a row pointed at nothing
		expect(findings).toEqual([
			expect.objectContaining({
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				phase: 'plan.md',
				location: 'plan.md:7',
				issue: expect.stringContaining('src/first.unit.test.ts'),
			}),
			expect.objectContaining({
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				phase: 'plan.md',
				location: 'plan.md:8',
				issue: expect.stringContaining('src/second.unit.test.ts'),
			}),
		]);
	});
});
