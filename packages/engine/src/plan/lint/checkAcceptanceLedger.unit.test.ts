import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkAcceptanceLedger } from '#src/plan/lint/checkAcceptanceLedger.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/** The gates a repository declares, so a row cannot name one nothing runs. */
const gateKeys = new Set(['check', 'test']);

/** One well-formed row covering the plan's created file. */
const goodRow = '| the parser reads a row | `src/parse.unit.test.ts` | reads a row | test |';

/** A plan creating one source file, with whatever ledger and prose sections the case gives it. */
const planWith = ({ ledger, prose = '' }: { ledger?: string; prose?: string }) =>
	parsePlan({
		content: `# Plan

## Files to Create

### \`src/parse.ts\`

The parser.
${ledger === undefined ? '' : `\n## Acceptance Tests\n\n| Criterion | Test file | Test name | Gate |\n|---|---|---|---|\n${ledger}\n`}${prose === '' ? '' : `\n## Prose Files\n\n${prose}\n`}`,
		base: 'plan.md',
	});

/** A repo holding `files`, and the check as the lint calls it. */
const check = async ({
	plan,
	required = true,
	files = {},
	gates = gateKeys,
}: {
	plan: ReturnType<typeof parsePlan>;
	required?: boolean;
	files?: Record<string, string>;
	gates?: Set<string>;
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ledger-'));

	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), text);
	}

	return checkAcceptanceLedger({ plan, cwd, phase: 'plan.md', required, gateKeys: gates });
};

/** Each finding as the terse pair the cases assert on. */
const reported = async (params: Parameters<typeof check>[0]) => (await check(params)).map(({ check: rule, location }) => ({ check: rule, location }));

describe('checkAcceptanceLedger', () => {
	test('a well-formed ledger covering the plan is silent', async () => {
		await expect(check({ plan: planWith({ ledger: goodRow }) })).resolves.toStrictEqual([]);
	});

	test('no section at all, on a plan that writes a source file, is one blocking finding', async () => {
		const findings = await check({ plan: planWith({}) });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				phase: 'plan.md',
				issue: 'no `## Acceptance Tests` section, and this plan writes source files no prose-files entry excuses',
				location: 'plan.md → Acceptance Tests',
				fix: 'add a `## Acceptance Tests` section with one row per acceptance criterion',
			},
		]);
	});

	test('with the switch off, an absent section is silence — a repository that never opted in sees nothing new', async () => {
		await expect(check({ plan: planWith({}), required: false })).resolves.toStrictEqual([]);
	});

	test('a section present but empty is a coverage finding whatever the switch says', async () => {
		expect(await reported({ plan: planWith({ ledger: '' }), required: false })).toStrictEqual([
			{ check: StructuralCheck.LedgerCovers, location: 'plan.md → Acceptance Tests' },
		]);
	});

	test('a malformed row is reported by its line', async () => {
		expect(await reported({ plan: planWith({ ledger: '| it parses | not-a-span | it parses | test |' }) })).toStrictEqual([
			{ check: StructuralCheck.LedgerWellFormed, location: 'plan.md:13' },
			{ check: StructuralCheck.LedgerCovers, location: 'plan.md → Acceptance Tests' },
		]);
	});

	test('a prose-files bullet naming a path with no reason is reported by its line', async () => {
		const plan = planWith({ ledger: goodRow, prose: '- `src/parse.ts`' });

		expect(await reported({ plan })).toStrictEqual([{ check: StructuralCheck.LedgerWellFormed, location: 'plan.md:17' }]);
	});

	test('a row naming a file that is not a test is a finding — the ledger names verifiers, not sources', async () => {
		const plan = planWith({ ledger: '| it parses | `src/parse.ts` | it parses | test |' });
		const findings = await check({ plan });

		expect(findings.map(({ issue }) => issue)).toStrictEqual(["ledger row names 'src/parse.ts', which is not a test file"]);
	});

	test('a row naming a gate nothing runs is a finding', async () => {
		const plan = planWith({ ledger: '| it parses | `src/parse.unit.test.ts` | it parses | smoke |' });
		const findings = await check({ plan });

		expect(findings.map(({ issue }) => issue)).toStrictEqual(["ledger row names gate 'smoke', which no configured gate runs"]);
	});

	test('a caller that declared no gates judges no row against them, rather than reporting every row', async () => {
		const plan = planWith({ ledger: '| it parses | `src/parse.unit.test.ts` | it parses | smoke |' });

		// an empty set is evidence of a missing config, never of a repository that
		// runs nothing
		await expect(check({ plan, gates: new Set() })).resolves.toStrictEqual([]);
	});

	test('two rows naming the same test in the same file are a finding on the second', async () => {
		const plan = planWith({ ledger: `${goodRow}\n${goodRow}` });
		const findings = await check({ plan });

		expect(findings.map(({ issue, location }) => ({ issue, location }))).toStrictEqual([
			{ issue: "two ledger rows name the same test: 'reads a row' in src/parse.unit.test.ts", location: 'plan.md:14' },
		]);
	});

	test('a row naming a test the file already holds is refused — an old test must not become a new criterion’s verifier', async () => {
		const plan = planWith({ ledger: goodRow });
		const files = { 'src/parse.unit.test.ts': "test('reads a row', () => {});\n" };
		const findings = await check({ plan, files });

		expect(findings.map(({ issue }) => issue)).toStrictEqual(["'reads a row' is already a test in src/parse.unit.test.ts"]);
	});

	test('a prose-files entry naming a path under none of the plan’s file headings is a coverage finding', async () => {
		const plan = planWith({ ledger: goodRow, prose: '- `docs/elsewhere.md` — a document states no behaviour' });

		expect(await reported({ plan })).toStrictEqual([{ check: StructuralCheck.LedgerCovers, location: 'plan.md:17' }]);
	});

	test('a plan whose only source file is excused by a reasoned prose entry needs no ledger at all', async () => {
		const plan = planWith({ prose: '- `src/parse.ts` — a config shim with no behaviour a test states' });

		await expect(check({ plan })).resolves.toStrictEqual([]);
	});
});
