import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { scanPlacement } from '../src/scan/scanPlacement';

const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

const setup = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-placement-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(join(process.cwd(), 'node_modules/typescript'), join(dir, 'node_modules/typescript'), 'dir');

	return dir;
};

test('scanPlacement flags a module-internal common file leaking to outside importers, sparing root common and internal use', async () => {
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

	const findings = await scanPlacement({ cwd: dir, files: Object.keys(files), compiler: ts });

	assert.ok(
		findings.every((finding) => finding.detector === 'placement' && finding.severity === 'finding'),
		'every finding is a placement finding',
	);
	assert.deepEqual(findings.map((finding) => finding.cluster).sort(), ['placement:src/pay/common/utils/round.ts'], 'only the leaked module-internal common file');

	const leak = findings.find((finding) => finding.cluster === 'placement:src/pay/common/utils/round.ts');
	assert.ok(leak?.detail.includes('src/bill/bill.ts') && leak.detail.includes('src/ledger/ledger.ts'), 'detail lists the outside consumers');
	assert.ok(leak?.detail.includes('src/common/'), 'detail points at the lowest common ancestor common/');
	assert.ok(!leak?.detail.includes('src/pay/pay.ts'), 'the module using its OWN common is not a consumer');
});
