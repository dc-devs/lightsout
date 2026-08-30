import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { FindingSeverity, LightsoutConfig, StructuralCheck } from '#src/contracts/index.ts';
import { lintPlanStructure } from '#src/plan/lint/lintPlanStructure.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The one required section a repository's own config adds: `## Documentation`,
// asked for on the implementable variants and only when a `docs` block is there.

/** Write a plan file into a plan's own folder and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

/** A repository declaring one documentation surface — the config the conditional required section keys off. */
const declaringConfig = () =>
	LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, docs: [{ path: 'README.md', covers: 'The product tour.' }] });

test('lintPlanStructure: a repository declaring documentation surfaces requires the section on an implementable plan', async () => {
	const cwd = setupConsumerRepo();
	const config = declaringConfig();
	const path = writePlan({ cwd, name: 'no-docs.md', body: cleanPlanBody() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], config });

	const sections = findings.filter((finding) => finding.check === StructuralCheck.SectionsPresent);

	// the heading the repository's own config added is the only one missing
	expect(sections.map(({ severity, fix }) => ({ severity, fix }))).toStrictEqual([
		{ severity: FindingSeverity.Blocking, fix: "add a '## Documentation' section" },
	]);
});

test('lintPlanStructure: the same plan carrying the section is clean', async () => {
	const cwd = setupConsumerRepo();
	const config = declaringConfig();
	const path = writePlan({ cwd, name: 'with-docs.md', body: cleanPlanBody({ documentation: 'Nothing user-facing — no docs needed.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], config });

	expect(findings).toStrictEqual([]);
});

test('lintPlanStructure: a repository declaring nothing never asks for the section', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'undeclared.md', body: cleanPlanBody() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// no block declared means no new question — the same plan body is clean
	expect(findings).toStrictEqual([]);
});

test('lintPlanStructure: an overview file never earns the finding, whatever the repository declares', async () => {
	const cwd = setupConsumerRepo();
	const config = declaringConfig();
	const overviewPath = writePlan({ cwd, name: 'overview.md', body: cleanOverviewBody() });
	const phasePath = writePlan({ cwd, name: 'phase1-core.md', body: cleanPlanBody({ documentation: 'Nothing user-facing — no docs needed.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [overviewPath, phasePath], config });

	// the overview creates nothing, so a claim written there would belong to no
	// executor
	expect(findings.filter((finding) => finding.issue.includes('Documentation'))).toStrictEqual([]);
});
