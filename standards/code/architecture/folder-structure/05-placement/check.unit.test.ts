import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** The resolved import edges an import-graph rule receives: repo-relative from/to pairs. */
const setupImportGraphInput = ({ edges }: { edges: Array<{ from: string; to: string }> }): StandardsCheckInput => {
	const files = [...new Set(edges.flatMap(({ from, to }) => [from, to]))];

	return {
		kind: StandardsInputKind.ImportGraph,
		cwd: '/repo',
		source: files,
		tests: [],
		files,
		referenceFiles: [],
		standardsPackages: [],
		edges,
	};
};

/** The input a rule that did NOT declare `import-graph` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/pay/pay.ts'],
	spans: [],
});

describe('placement check', () => {
	test('asks for the import graph, since the verdict is about the boundary an import crosses', () => {
		expect(check.inputKind).toBe('import-graph');
	});

	test('reports a module-internal common file an outside module imports, sparing the module using its own common', async () => {
		const input = setupImportGraphInput({
			edges: [
				{ from: 'src/pay/index.ts', to: 'src/pay/pay.ts' },
				{ from: 'src/pay/pay.ts', to: 'src/pay/common/utils/round.ts' },
				{ from: 'src/bill/bill.ts', to: 'src/pay/common/utils/round.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'placement:src/bill/bill.ts|src/pay/common/utils/round.ts',
				files: [{ path: 'src/pay/common/utils/round.ts' }, { path: 'src/bill/bill.ts' }],
				detail:
					"'src/pay/common/utils/round.ts' is internal to module 'src/pay' (under its common/) but imported by src/bill/bill.ts — promote to src/common/",
				guidance: 'Shared code belongs in the common/ of the lowest folder that contains everyone using it.',
			},
		]);
	});

	test('a module reaching only into its own common, beside a repo-level common everyone shares, earns no finding', async () => {
		const input = setupImportGraphInput({
			edges: [
				{ from: 'src/pay/index.ts', to: 'src/pay/pay.ts' },
				{ from: 'src/pay/pay.ts', to: 'src/pay/common/utils/round.ts' },
				{ from: 'src/other/other.ts', to: 'src/common/utils/shared.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('several outside importers of one file join a single finding, named in alphabetical order', async () => {
		const input = setupImportGraphInput({
			edges: [
				{ from: 'src/ledger/ledger.ts', to: 'src/pay/common/utils/round.ts' },
				{ from: 'src/bill/bill.ts', to: 'src/pay/common/utils/round.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'placement:src/bill/bill.ts|src/ledger/ledger.ts|src/pay/common/utils/round.ts',
				files: [{ path: 'src/pay/common/utils/round.ts' }, { path: 'src/bill/bill.ts' }, { path: 'src/ledger/ledger.ts' }],
				detail:
					"'src/pay/common/utils/round.ts' is internal to module 'src/pay' (under its common/) but imported by src/bill/bill.ts, src/ledger/ledger.ts — promote to src/common/",
				guidance: 'Shared code belongs in the common/ of the lowest folder that contains everyone using it.',
			},
		]);
	});

	test('the same importer reaching into two different modules earns one finding per leaked file', async () => {
		const input = setupImportGraphInput({
			edges: [
				{ from: 'src/bill/bill.ts', to: 'src/pay/common/utils/round.ts' },
				{ from: 'src/bill/bill.ts', to: 'src/tax/common/utils/rate.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'placement:src/bill/bill.ts|src/pay/common/utils/round.ts',
			'placement:src/bill/bill.ts|src/tax/common/utils/rate.ts',
		]);
	});

	test('a file no module owns — a repo-root common/, or a path with no common/ at all — is never a leak', async () => {
		const input = setupImportGraphInput({
			edges: [
				// `common` is the first path segment: no folder above it could own it
				{ from: 'feature/thing.ts', to: 'common/utils/round.ts' },
				// an ordinary cross-module import, nowhere near a common/
				{ from: 'billing/bill.ts', to: 'pay/pay.ts' },
				// a genuine leak, so the two exclusions above are not vacuous
				{ from: 'billing/bill.ts', to: 'pay/common/utils/scale.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['placement:billing/bill.ts|pay/common/utils/scale.ts']);
	});

	test('an owner and importer sharing no folder promote to the repo root common/', async () => {
		const input = setupImportGraphInput({
			edges: [{ from: 'billing/bill.ts', to: 'pay/common/utils/round.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe(
			"'pay/common/utils/round.ts' is internal to module 'pay' (under its common/) but imported by billing/bill.ts — promote to /common/",
		);
	});

	test('a common/ nested inside another common/ is owned by the innermost module, not the outer one', async () => {
		const input = setupImportGraphInput({
			edges: [{ from: 'src/app/common/services/other.ts', to: 'src/app/common/services/client/common/utils/parse.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe(
			"'src/app/common/services/client/common/utils/parse.ts' is internal to module 'src/app/common/services/client' (under its common/) but imported by src/app/common/services/other.ts — promote to src/app/common/services/common/",
		);
	});

	test('a repo whose files import nothing earns no finding', async () => {
		const input = setupImportGraphInput({ edges: [] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
