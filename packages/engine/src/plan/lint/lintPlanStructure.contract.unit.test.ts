import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { FindingSeverity, LightsoutConfig, StructuralCheck } from '#src/contracts/index.ts';
import { lintPlanStructure } from '#src/plan/lint/lintPlanStructure.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The one required section `plan.contract` adds — `## Acceptance Tests`, asked
// for on the implementable variants — and the ledger rule that runs whenever the
// section is there, switch or no switch.

/** Write a plan file into a plan's own folder and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

/** The repository's config, writing contract plans or not. */
const configWith = ({ contract }: { contract: boolean }) =>
	LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ...(contract ? { plan: { contract: true } } : {}) });

/** The clean plan body with an acceptance-test ledger covering the file it creates. */
const contractPlanBody = () =>
	`${cleanPlanBody()}
## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
| newThing is re-exported | \`src/newThing.unit.test.ts\` | re-exports newThing | test |
`;

test('lintPlanStructure: a repository writing contract plans requires the ledger section on an implementable plan', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'no-ledger.md', body: cleanPlanBody() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], config: configWith({ contract: true }) });

	// the heading the switch added, and the ledger rule reporting the same absence
	expect(findings.map(({ check, fix }) => ({ check, fix }))).toStrictEqual([
		{ check: StructuralCheck.SectionsPresent, fix: "add a '## Acceptance Tests' section" },
		{ check: StructuralCheck.LedgerWellFormed, fix: 'add a `## Acceptance Tests` section with one row per acceptance criterion' },
	]);
});

test('lintPlanStructure: the same plan carrying a ledger is clean, and its test path is never reported as a prose path', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'with-ledger.md', body: contractPlanBody() });

	// the ledger section is that test file's declaration, exactly as a `###`
	// heading is a created file's
	await expect(lintPlanStructure({ cwd, planPaths: [path], config: configWith({ contract: true }) })).resolves.toStrictEqual([]);
});

test('lintPlanStructure: with the switch off, a plan carrying a ledger is still checked against it', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'off-but-present.md', body: contractPlanBody().replace('| test |', '| smoke |') });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], config: configWith({ contract: false }) });

	// a plan written where the switch is on must not lose its checks where it is off
	expect(findings.map(({ check, severity, issue }) => ({ check, severity, issue }))).toStrictEqual([
		{
			check: StructuralCheck.LedgerWellFormed,
			severity: FindingSeverity.Blocking,
			issue: "ledger row names gate 'smoke', which no configured gate runs",
		},
	]);
});

test('lintPlanStructure: an overview file is never asked for a ledger, whatever the repository writes', async () => {
	const cwd = setupConsumerRepo();
	const overviewPath = writePlan({ cwd, name: 'overview.md', body: cleanOverviewBody() });
	const phasePath = writePlan({ cwd, name: 'phase1-core.md', body: contractPlanBody() });

	const findings = await lintPlanStructure({ cwd, planPaths: [overviewPath, phasePath], config: configWith({ contract: true }) });

	// the overview creates nothing, so a row written there would belong to no
	// executor
	expect(findings.filter(({ issue }) => issue.includes('Acceptance Tests'))).toStrictEqual([]);
});

test('lintPlanStructure: a repository that never declared the key sees no ledger requirement at all', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'undeclared.md', body: cleanPlanBody() });

	await expect(lintPlanStructure({ cwd, planPaths: [path] })).resolves.toStrictEqual([]);
});
