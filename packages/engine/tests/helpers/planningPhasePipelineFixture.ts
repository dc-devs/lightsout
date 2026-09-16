import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { planningHandoffFixture } from '#tests/helpers/planningHandoffFixture.ts';
import { report } from '#tests/helpers/report.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';

/** Real phased planning and real gate assertions with controlled writer/reviewer responses, never a paid provider. */
export const planningPhasePipelineFixture = async () => {
	const fixture = await planningHandoffFixture({ phased: true });
	const calls: DriverInvocation[] = [];
	let active = 'retryUpload';
	await mkdir(join(fixture.cwd, 'src'), { recursive: true });
	await writeFile(
		join(fixture.cwd, '.lightsout/phase-gate.cjs'),
		`
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).name, 'workflow-test');
const testResults = [{ testFilePath: path.resolve('.lightsout/phase-gate.cjs'), assertionResults: [{ title: 'baseline package metadata', fullName: 'baseline package metadata', status: 'passed' }] }];
for (const [stem, name] of [['retryUpload', 'retains completed uploads after retry failure'], ['retryReport', 'reports retained retry completion']]) {
  const source = path.resolve('src', stem + '.ts');
  if (!fs.existsSync(source)) continue;
  assert.equal(require(source).retain(), 'retained', stem + ' must preserve completion');
  const testFilePath = path.resolve('src', stem + '.unit.test.ts');
  assert.ok(fs.readFileSync(testFilePath, 'utf8').includes(name));
  testResults.push({ testFilePath, assertionResults: [{ title: name, fullName: name, status: 'passed' }] });
}
fs.writeFileSync(path.join(process.env.LIGHTSOUT_TEST_RESULTS_DIR, 'results.json'), JSON.stringify({ testResults }));
`,
	);
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async (invocation) => {
				calls.push(invocation);
				const ledger = /Write these tests, and only these, in `src\/(retryUpload|retryReport)\.unit\.test\.ts`/.exec(invocation.prompt);
				if (ledger) {
					active = ledger[1];
					const name = active === 'retryUpload' ? 'retains completed uploads after retry failure' : 'reports retained retry completion';
					const path = `src/${active}.unit.test.ts`;
					await writeFile(
						join(fixture.cwd, path),
						`import { test, expect } from '@jest/globals';\nimport { retain } from './${active}.ts';\ntest('${name}', () => expect(retain()).toBe('retained'));\n`,
					);
					return { exitCode: 0, text: report({ changedFiles: [{ path, summary: 'Exact acceptance test' }] }) };
				}
				if (roleOf(invocation.prompt) === 'implement') {
					const path = `src/${active}.ts`;
					await writeFile(join(fixture.cwd, path), "export const retain = () => 'retained';\n");
					return { exitCode: 0, text: report({ changedFiles: [{ path, summary: 'Preserve completion' }] }) };
				}
				return { exitCode: 0, text: report() };
			},
		}),
	};
	const config = { ...fixture.config, gates: { check: 'true', test: 'node .lightsout/phase-gate.cjs', 'test-coverage': false as const } };
	return { ...fixture, driver, config, calls, overviewPath: fixture.plan };
};
