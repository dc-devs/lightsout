import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { runScan } from '@/scan';

const setupStructureRepo = ({ files }: { files: Record<string, string> }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-structure-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return { dir };
};

/** `count` single-export files in one flat folder — the folder-census input. */
const flatFolder = ({ dir, prefix, count }: { dir: string; prefix: string; count: number }) =>
	Object.fromEntries(
		Array.from({ length: count }, (_, index): [string, string] => [`${dir}/${prefix}${index}.ts`, `export const ${prefix}${index} = ${index};\n`]),
	);

describe('scanStructure', () => {
	test('grades a multi-export file as a finding and a filename mismatch as an advisory, never both on one file', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/pay/config.ts': 'export const loadConfig = () => 1;\nexport const saveConfig = () => 2;\n',
				'src/pay/helpers.ts': 'export const buildLabel = () => 1;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.detector === 'structure');
		const multi = findings.find((finding) => finding.cluster === 'multi-export:src/pay/config.ts');
		const mismatch = findings.find((finding) => finding.cluster === 'filename-mismatch:src/pay/helpers.ts');

		assert.equal(multi?.severity, 'finding', 'one-export-per-file is a rule violation');
		assert.ok(multi?.detail.includes('loadConfig') && multi.detail.includes('saveConfig'), `the detail names the competing exports: ${multi?.detail}`);
		assert.deepEqual(multi?.files, [{ path: 'src/pay/config.ts' }], 'the finding points at the offending file');
		assert.equal(mismatch?.severity, 'advisory', 'a filename mismatch is judgment-adjacent, never a rule violation');
		assert.ok(mismatch?.detail.includes('buildLabel'), `the detail names the export the filename should follow: ${mismatch?.detail}`);
		assert.ok(
			!findings.some((finding) => finding.cluster === 'filename-mismatch:src/pay/config.ts'),
			'a file with several exports has no single export its filename could match',
		);
	});

	test('exempts a union family — interfaces plus exactly one type alias — from one-export-per-file', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/shape/Shape.ts': 'export interface Circle {\n\tradius: number;\n}\n\nexport interface Square {\n\tside: number;\n}\n\nexport type Shape = Circle | Square;\n',
				// one interface, TWO aliases — outside the closed exception
				'src/shape/Region.ts': 'export interface Zone {\n\tid: string;\n}\n\nexport type Region = Zone;\n\nexport type Bounds = Zone;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.detector === 'structure');

		assert.deepEqual(
			findings.map((finding) => finding.cluster),
			['multi-export:src/shape/Region.ts'],
			'the discriminated union stays together; a second alias breaks the family',
		);
	});

	test('exempts a named constant with its derived type and Record lookup maps', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/order/OrderStatus.ts':
					"export const OrderStatus = {\n\tOpen: 'open',\n\tClosed: 'closed',\n} as const;\n\nexport type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];\n\nexport const orderStatusLabel: Record<OrderStatus, string> = {\n\topen: 'Open',\n\tclosed: 'Closed',\n};\n",
				// same const+type pair, but the third export is unrelated logic
				'src/order/OrderKind.ts':
					"export const OrderKind = {\n\tRush: 'rush',\n} as const;\n\nexport type OrderKind = (typeof OrderKind)[keyof typeof OrderKind];\n\nexport const parseOrderKind = (value: string) => value;\n",
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.detector === 'structure');

		assert.deepEqual(
			findings.map((finding) => finding.cluster),
			['multi-export:src/order/OrderKind.ts'],
			'the lookup map rides along with its constant; an unrelated const does not',
		);
	});

	test('skips barrels — an index file is judged on neither export count nor filename', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/mod/index.ts': 'export const alpha = 1;\nexport const beta = 2;\n',
				'src/mod/gamma.ts': 'export const gamma = 3;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.detector === 'structure');

		assert.deepEqual(findings.map((finding) => finding.cluster), [], `a barrel is exempt from both structure rules:\n${JSON.stringify(findings, undefined, 1)}`);
	});

	test('skips a file that exports nothing rather than matching its filename against no export', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/mod/bootstrap.ts': "import { gamma } from './gamma';\n\nconsole.log(gamma);\n",
				'src/mod/gamma.ts': 'export const gamma = 3;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.detector === 'structure');

		assert.deepEqual(findings.map((finding) => finding.cluster), [], `an export-free file has no contract to mismatch:\n${JSON.stringify(findings, undefined, 1)}`);
	});

	test('groups repeated first tokens only inside a utils/ folder', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/a/utils/formatDate.ts': 'export const formatDate = () => 1;\n',
				'src/a/utils/formatCurrency.ts': 'export const formatCurrency = () => 2;\n',
				// a lone verb in the same folder is not a group
				'src/a/utils/parseDate.ts': 'export const parseDate = () => 3;\n',
				// the same repeated verb outside utils/ is ordinary domain code
				'src/a/helpers/formatName.ts': 'export const formatName = () => 4;\n',
				'src/a/helpers/formatCode.ts': 'export const formatCode = () => 5;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.detector === 'structure');
		const domain = findings.filter((finding) => finding.cluster.startsWith('domain:'));

		assert.deepEqual(domain.map((finding) => finding.cluster), ['domain:src/a/utils:format'], 'only a repeated verb inside utils/ is a graduation candidate');
		assert.equal(domain[0]?.severity, 'advisory', 'graduation is a heuristic, never a rule violation');
		assert.deepEqual(
			domain[0]?.files.map((file) => file.path).sort(),
			['src/a/utils/formatCurrency.ts', 'src/a/utils/formatDate.ts'],
			'the finding lists every file in the group',
		);
	});

	test('flags a folder over the census cap, counting every file including its barrel', async () => {
		const { dir } = setupStructureRepo({
			files: {
				...flatFolder({ dir: 'src/wide', prefix: 'wide', count: 20 }),
				// the 21st file — a barrel still counts toward the census
				'src/wide/index.ts': "export { wide0 } from './wide0';\n",
				// exactly at the cap — the threshold is strictly greater than
				...flatFolder({ dir: 'src/narrow', prefix: 'narrow', count: 20 }),
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.detector === 'structure');
		const census = findings.filter((finding) => finding.cluster.startsWith('census:'));

		assert.deepEqual(census.map((finding) => finding.cluster), ['census:src/wide'], 'a folder sitting exactly at the cap is not flagged');
		assert.equal(census[0]?.severity, 'advisory', 'the census is a heuristic, never a rule violation');
		assert.deepEqual(census[0]?.files, [{ path: 'src/wide' }], 'the finding points at the folder, not a file');
		assert.ok(census[0]?.detail.includes('21 files'), `the detail counts the barrel too: ${census[0]?.detail}`);
	});
});
