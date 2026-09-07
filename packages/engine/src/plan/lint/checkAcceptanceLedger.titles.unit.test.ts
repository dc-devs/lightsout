import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkAcceptanceLedger } from '#src/plan/lint/checkAcceptanceLedger.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/** A plan creating one source file, with the ledger rows the case gives it. */
const planFor = ({ rows }: { rows: string[] }) =>
	parsePlan({
		content: `# Plan

## Files to Create

### \`src/parse.ts\`

The parser.

## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
${rows.join('\n')}
`,
		base: 'plan.md',
	});

/** The plan, a repository holding `files`, and the gate keys the config declares. */
const setupLedger = ({
	rows,
	files = {},
	gates = ['check', 'build', 'test', 'test-coverage', 'test-e2e'],
}: {
	rows: string[];
	files?: Record<string, string>;
	gates?: string[];
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ledger-titles-'));

	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), text);
	}

	return { plan: planFor({ rows }), cwd, gateKeys: new Set(gates) };
};

describe('checkAcceptanceLedger', () => {
	test('checkAcceptanceLedger: reports an already-stated test by its call head and accepts a name that only appears in a comment', async () => {
		const { plan, cwd, gateKeys } = setupLedger({
			rows: [
				'| the parser reads a row | `src/stated.unit.test.ts` | reads a row | test |',
				'| the parser writes a row | `src/prose.unit.test.ts` | writes a row | test |',
			],
			files: {
				'src/stated.unit.test.ts': "test('reads a row', () => {});\n",
				'src/prose.unit.test.ts': [
					'// writes a row is the case this plan adds',
					"describe('writes a row', () => {",
					"\tconst label = 'writes a row';",
					"\ttest('an older case', () => {});",
					'});',
					'',
				].join('\n'),
			},
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		expect(findings).toEqual([
			expect.objectContaining({
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				issue: expect.stringMatching(/reads a row[\s\S]*src\/stated\.unit\.test\.ts/),
			}),
		]);
	});

	test('checkAcceptanceLedger: refuses a row naming a gate that runs no tests, and accepts test, test-coverage and a custom test suite', async () => {
		const { plan, cwd, gateKeys } = setupLedger({
			rows: [
				'| the parser is linted | `src/linted.unit.test.ts` | states the lint gate | check |',
				'| the parser reads a row | `src/plain.unit.test.ts` | states the test gate | test |',
				'| the parser is covered | `src/covered.unit.test.ts` | states the coverage gate | test-coverage |',
				'| the parser runs end to end | `src/e2e.unit.test.ts` | states a custom suite | test-e2e |',
			],
		});

		const findings = await checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required: true, gateKeys });

		expect(findings).toEqual([
			expect.objectContaining({
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				issue: expect.stringMatching(/\bcheck\b/),
			}),
		]);
	});
});
