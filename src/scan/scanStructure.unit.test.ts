import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
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

		const findings = allFindings.filter((finding) => finding.rule === 'structure');
		const multi = findings.find((finding) => finding.siteKey === 'multi-export:src/pay/config.ts');
		const mismatch = findings.find((finding) => finding.siteKey === 'filename-mismatch:src/pay/helpers.ts');

		// one-export-per-file is a rule violation
		expect(multi?.severity).toBe('finding');
		// the detail names the competing exports: ${multi?.detail}
		expect(multi?.detail.includes('loadConfig') && multi.detail.includes('saveConfig')).toBeTruthy();
		// the finding points at the offending file
		expect(multi?.files).toStrictEqual([{ path: 'src/pay/config.ts' }]);
		// a filename mismatch is judgment-adjacent, never a rule violation
		expect(mismatch?.severity).toBe('advisory');
		// the detail names the export the filename should follow: ${mismatch?.detail}
		expect(mismatch?.detail.includes('buildLabel')).toBeTruthy();
		// a file with several exports has no single export its filename could match
		expect(findings.some((finding) => finding.siteKey === 'filename-mismatch:src/pay/config.ts')).toBeFalsy();
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

		const findings = allFindings.filter((finding) => finding.rule === 'structure');

		// the discriminated union stays together; a second alias breaks the family
		expect(findings.map((finding) => finding.siteKey)).toStrictEqual(['multi-export:src/shape/Region.ts']);
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

		const findings = allFindings.filter((finding) => finding.rule === 'structure');

		// the lookup map rides along with its constant; an unrelated const does not
		expect(findings.map((finding) => finding.siteKey)).toStrictEqual(['multi-export:src/order/OrderKind.ts']);
	});

	test('skips barrels — an index file is judged on neither export count nor filename', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/mod/index.ts': 'export const alpha = 1;\nexport const beta = 2;\n',
				'src/mod/gamma.ts': 'export const gamma = 3;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.rule === 'structure');

		// a barrel is exempt from both structure rules:\n${JSON.stringify(findings,
		// undefined, 1)}
		expect(findings.map((finding) => finding.siteKey)).toStrictEqual([]);
	});

	test('skips a file that exports nothing rather than matching its filename against no export', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/mod/bootstrap.ts': "import { gamma } from './gamma';\n\nconsole.log(gamma);\n",
				'src/mod/gamma.ts': 'export const gamma = 3;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.rule === 'structure');

		// an export-free file has no contract to mismatch:\n${JSON.stringify(findings,
		// undefined, 1)}
		expect(findings.map((finding) => finding.siteKey)).toStrictEqual([]);
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

		const findings = allFindings.filter((finding) => finding.rule === 'structure');
		const domain = findings.filter((finding) => finding.siteKey.startsWith('domain:'));

		// only a repeated verb inside utils/ is a graduation candidate
		expect(domain.map((finding) => finding.siteKey)).toStrictEqual(['domain:src/a/utils:format']);
		// graduation is a heuristic, never a rule violation
		expect(domain[0]?.severity).toBe('advisory');
		// the finding lists every file in the group
		expect(domain[0]?.files.map((file) => file.path).sort()).toStrictEqual(['src/a/utils/formatCurrency.ts', 'src/a/utils/formatDate.ts']);
	});

	test('never groups on a verb that only says how a value is reached', async () => {
		const { dir } = setupStructureRepo({
			files: {
				'src/a/utils/isTestFile.ts': 'export const isTestFile = () => true;\n',
				'src/a/utils/isInertFile.ts': 'export const isInertFile = () => true;\n',
				'src/a/utils/resolveConfig.ts': 'export const resolveConfig = () => 1;\n',
				'src/a/utils/resolveDriver.ts': 'export const resolveDriver = () => 2;\n',
				// a verb that carries a subject with it still graduates
				'src/a/utils/validateEmail.ts': 'export const validateEmail = () => 1;\n',
				'src/a/utils/validatePhone.ts': 'export const validatePhone = () => 2;\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const domain = allFindings.filter((finding) => finding.rule === 'structure' && finding.siteKey.startsWith('domain:'));

		// is*/resolve* would graduate to `predicates/` and `resolution/` — folders
		// named for the ROLE of the code they hold, which folder-structure.md bans;
		// `validation/` names a subject, which is what a domain folder is for
		expect(domain.map((finding) => finding.siteKey)).toStrictEqual(['domain:src/a/utils:validate']);
	});

	test('reads a generator template line as string content, not as a second export', async () => {
		const { dir } = setupStructureRepo({
			files: {
				// the emitted text starts at column 0 and reads exactly like a
				// declaration, but it sits inside a template literal
				'src/gen/writeBarrel.ts':
					'export const writeBarrel = ({ name }: { name: string }) => {\n\treturn `// generated\nexport const ${name}: Record<string, string> = {};\n`;\n};\n',
			},
		});

		const { findings: allFindings } = await runScan({ cwd: dir, persist: false });

		const findings = allFindings.filter((finding) => finding.rule === 'structure');

		// one real export, whose name the filename already matches — counting the
		// interpolated placeholder would make this a multi-export violation
		expect(findings.map((finding) => finding.siteKey)).toStrictEqual([]);
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

		const findings = allFindings.filter((finding) => finding.rule === 'structure');
		const census = findings.filter((finding) => finding.siteKey.startsWith('census:'));

		// a folder sitting exactly at the cap is not flagged
		expect(census.map((finding) => finding.siteKey)).toStrictEqual(['census:src/wide']);
		// the census is a heuristic, never a rule violation
		expect(census[0]?.severity).toBe('advisory');
		// the finding points at the folder, not a file
		expect(census[0]?.files).toStrictEqual([{ path: 'src/wide' }]);
		// the detail counts the barrel too: ${census[0]?.detail}
		expect(census[0]?.detail.includes('21 files')).toBeTruthy();
	});
});
