import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { runStandardsCheck } from '@/standardsCheck';

const setup = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-placement-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	// The placement detector needs import resolution — hand the fixture our TS.
	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');

	return dir;
};

test('checkPlacement flags a module-internal common file leaking to outside importers, sparing root common and internal use', async () => {
	const files = {
		'src/pay/index.ts': "export { pay } from './pay';\n",
		'src/pay/pay.ts': "import { round } from './common/utils/round';\nexport const pay = round;\n",
		'src/pay/common/utils/round.ts': 'export const round = 1;\n',
		// two outside consumers of pay's internal common → a placement leak
		'src/bill/bill.ts': "import { round } from '../pay/common/utils/round';\nexport const bill = round;\n",
		'src/ledger/ledger.ts': "import { round } from '../pay/common/utils/round';\nexport const ledger = round;\n",
		// repo-level common is shared by design — importing it is never a leak
		'src/common/utils/shared.ts': 'export const shared = 9;\n',
		'src/other/other.ts': "import { shared } from '../common/utils/shared';\nexport const other = shared;\n",
	};
	const dir = setup(files);

	const { findings: allFindings } = await runStandardsCheck({ cwd: dir, persist: false });
	const findings = allFindings.filter((finding) => finding.rule === 'placement');

	// every placement finding carries the finding severity
	expect(findings.every((finding) => finding.severity === 'finding')).toBeTruthy();
	// only the leaked module-internal common file
	expect(findings.map((finding) => finding.siteKey).sort()).toStrictEqual(['placement:src/bill/bill.ts|src/ledger/ledger.ts|src/pay/common/utils/round.ts']);

	const leak = findings.find((finding) => finding.siteKey === 'placement:src/bill/bill.ts|src/ledger/ledger.ts|src/pay/common/utils/round.ts');
	// detail lists the outside consumers
	expect(leak?.detail.includes('src/bill/bill.ts') && leak.detail.includes('src/ledger/ledger.ts')).toBeTruthy();
	// detail points at the lowest common ancestor common/
	expect(leak?.detail.includes('src/common/')).toBeTruthy();
	// the module using its OWN common is not a consumer
	expect(leak?.detail.includes('src/pay/pay.ts')).toBeFalsy();
});

test('a top-level common/ folder is owned by no module, so importing it is never a leak', async () => {
	const files = {
		// `common` is the FIRST path segment — there is no folder above it that
		// could own it, which is a different case from src/common (owned by src).
		'common/utils/round.ts': 'export const round = 1;\n',
		'feature/thing.ts': "import { round } from '../common/utils/round';\nexport const thing = round;\n",
		// A genuine module-internal leak, so the exclusion above is not vacuous.
		'pay/index.ts': "export { pay } from './pay';\n",
		'pay/pay.ts': "import { scale } from './common/utils/scale';\nexport const pay = scale;\n",
		'pay/common/utils/scale.ts': 'export const scale = 2;\n',
		'billing/bill.ts': "import { scale } from '../pay/common/utils/scale';\nexport const bill = scale;\n",
	};
	const dir = setup(files);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const placement = findings.filter((finding) => finding.rule === 'placement');

	expect(placement.map((finding) => finding.siteKey)).toStrictEqual(['placement:billing/bill.ts|pay/common/utils/scale.ts']);
});

test('a leak whose owner and consumer share no ancestor promotes to the repo root common/', async () => {
	const files = {
		'pay/index.ts': "export { pay } from './pay';\n",
		'pay/pay.ts': "import { round } from './common/utils/round';\nexport const pay = round;\n",
		'pay/common/utils/round.ts': 'export const round = 1;\n',
		// Top-level sibling tree: nothing is shared above it, so the lowest
		// common ancestor is the repo root itself.
		'billing/bill.ts': "import { round } from '../pay/common/utils/round';\nexport const bill = round;\n",
	};
	const dir = setup(files);

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });

	const leak = findings.find((finding) => finding.siteKey === 'placement:billing/bill.ts|pay/common/utils/round.ts');
	// the outside consumer is named:\n${JSON.stringify(findings, undefined, 1)}
	expect(leak?.detail.includes('billing/bill.ts')).toBeTruthy();
	// no shared ancestor puts the promotion target at the root: ${leak?.detail}
	expect(leak?.detail.includes('promote to /common/')).toBeTruthy();
});
