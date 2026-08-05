import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LightsoutConfig, StructuralCheck } from '@/contracts';
import { lintPlanStructure } from '@/plan';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Write a plan file into the repo and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.claude', 'plans');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

/** A structurally clean single/phase plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Clean Plan

## Context

A tiny clean plan for the structural lint.

## Global Constraints

- None

## Prerequisites

- None

## Files to Create

### \`src/new-thing.ts\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing/new-thing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None — standalone plan.
`;

test('lintPlanStructure: a missing Files to Modify path is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'missing-modify.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/does-not-exist.ts\`

Change something.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('src/does-not-exist.ts')),
		'the missing modify path is flagged',
	);
});

test('lintPlanStructure: a Files to Create path that already exists is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'create-exists.md',
		body: `# Plan

## Prerequisites

- None

## Files to Create

### \`src/index.js\`

But this already exists.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('already exists')),
		'the create path that exists is flagged',
	);
});

test('lintPlanStructure: a missing Patterns to Mirror path is flagged with its plan-relative location and fix', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'missing-mirror.md',
		body: `# Plan

## Prerequisites

- None

## Patterns to Mirror

- \`src/gone.ts\` — mirror its single-export shape.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.PathExists),
		[
			{
				check: StructuralCheck.PathExists,
				issue: 'referenced path does not exist: src/gone.ts',
				location: 'missing-mirror.md → src/gone.ts',
				fix: 'correct the path or move it under Files to Create if it does not exist yet',
			},
		],
		'a mirror target is stated as existing code — a missing one is the same defect as a missing modify path',
	);
});

test('lintPlanStructure: a Files to Create path that exists is flagged with a location and a fix that moves it', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'create-exists-detail.md',
		body: `# Plan

## Prerequisites

- None

## Files to Create

### \`src/index.js\`

But this already exists.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.PathExists),
		[
			{
				check: StructuralCheck.PathExists,
				issue: 'Files to Create path already exists: src/index.js',
				location: 'create-exists-detail.md → src/index.js',
				fix: 'move it to Files to Modify, or choose a new path',
			},
		],
	);
});

test('lintPlanStructure: a TBD placeholder is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'placeholder.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Do TBD here.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders), 'the TBD is flagged');
});

test('lintPlanStructure: a missing "What Next Plan Expects" section is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-next.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change it.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('What Next Plan Expects')),
		'the missing section is flagged',
	);
});

test('lintPlanStructure: a missing "Global Constraints" section is flagged on an implementable plan', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-constraints.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change it.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('Global Constraints')),
		'the missing section is flagged',
	);
});

test('lintPlanStructure: a missing "Global Constraints" section is flagged on an overview plan', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'overview-no-constraints.md',
		body: `# Plan — Overview

## Context

An overview without the constraints section.

## Phases

| # | File | Scope |
|---|------|-------|
| 1 | \`phase1-core.md\` | the core |

## Cross-Phase Dependencies

- None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some(
			(finding) =>
				finding.check === StructuralCheck.SectionsPresent &&
				finding.issue.includes('Global Constraints') &&
				finding.issue.includes('overview'),
		),
		'the missing section is flagged on the overview variant',
	);
});

test('lintPlanStructure: a 60-file plan trips ScopeWithinGuardrail', async () => {
	const cwd = setupConsumerRepo();
	const creates = Array.from({ length: 60 }, (_, index) => `### \`src/gen${index}.ts\`\n\nGenerated module ${index}.\n`).join('\n');
	const path = writePlan({
		cwd,
		name: 'too-big.md',
		body: `# Plan

## Prerequisites

- None

## Files to Create

${creates}

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(findings.some((finding) => finding.check === StructuralCheck.ScopeWithinGuardrail), 'the oversized plan is flagged');
});

test('lintPlanStructure: a clean plan returns no findings', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'clean.md', body: cleanPlan() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(findings, [], `clean plan should have no findings, got: ${JSON.stringify(findings)}`);
});

/** The clean plan with a snippet standing in for its Context prose. */
const planWith = ({ snippet }: { snippet: string }) => cleanPlan().replace('A tiny clean plan for the structural lint.', snippet);

/** The NoPlaceholders findings a plan built around `snippet` produces. */
const placeholderFindings = async ({ name, snippet }: { name: string; snippet: string }) => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name, body: planWith({ snippet }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	return findings.filter((finding) => finding.check === StructuralCheck.NoPlaceholders);
};

test('lintPlanStructure: a template-literal interpolation inside a fenced block is not a placeholder', async () => {
	const findings = await placeholderFindings({
		name: 'fenced-interpolation.md',
		snippet: '```ts\nconst greeting = `hi ${userName}`;\n```',
	});

	assert.deepEqual(findings, [], `a fenced interpolation must not be flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a template-literal interpolation in prose is not a placeholder — the lookbehind covers it outside fences', async () => {
	const findings = await placeholderFindings({
		name: 'prose-interpolation.md',
		snippet: 'The writer interpolates `hi ${userName}` into the greeting.',
	});

	assert.deepEqual(findings, [], `a prose interpolation must not be flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: destructuring inside a fenced block is not a placeholder', async () => {
	const findings = await placeholderFindings({
		name: 'fenced-destructuring.md',
		snippet: '```tsx\nconst {userName} = props;\n\nreturn <span>{userName}</span>;\n```',
	});

	assert.deepEqual(findings, [], `fenced code braces must not be flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a bare brace-token in prose is still flagged', async () => {
	const findings = await placeholderFindings({ name: 'prose-token.md', snippet: 'Resolve the {token} before writing.' });

	assert.equal(findings.length, 1, `the prose brace-token is flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a brace-token in an inline code span is still flagged — fences only, never spans', async () => {
	const findings = await placeholderFindings({ name: 'span-token.md', snippet: 'Place it at `packages/{package}/src/thing.ts`.' });

	assert.equal(findings.length, 1, `the inline-span brace-token is flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a TODO inside a fenced block is still flagged — fences suppress only the brace-token', async () => {
	const findings = await placeholderFindings({ name: 'fenced-todo.md', snippet: '```ts\n// TODO: decide later\n```' });

	assert.equal(findings.length, 1, `the fenced TODO is flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: fence state resets per file — an unclosed fence never silences the next plan', async () => {
	const cwd = setupConsumerRepo();
	const unclosed = writePlan({ cwd, name: 'unclosed-fence.md', body: planWith({ snippet: '```ts\nconst {userName} = props;' }) });
	const following = writePlan({ cwd, name: 'after-fence.md', body: planWith({ snippet: 'Resolve the {token} before writing.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [unclosed, following] });
	const placeholders = findings.filter((finding) => finding.check === StructuralCheck.NoPlaceholders);

	assert.equal(placeholders.length, 1, `only the second plan's prose token is flagged, got: ${JSON.stringify(placeholders)}`);
	assert.ok(placeholders[0].location.startsWith('after-fence.md:'), 'the finding is attributed to the second plan');
});

/** A minimal plan whose only lint-relevant content is one verification command. */
const verificationPlan = ({ command }: { command: string }) => `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change something.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`${command}\` — gates green

## What Next Plan Expects

None.
`;

test('lintPlanStructure: `pnpm --filter <pkg> run <script>` resolves the script, not the `run` token', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'filter-run.md', body: verificationPlan({ command: 'pnpm --filter consumer run check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		!findings.some((finding) => finding.check === StructuralCheck.ScriptExists),
		`existing script behind --filter … run must not be flagged, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: `pnpm -F <pkg> <script>` resolves the script, not the flag', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'short-filter.md', body: verificationPlan({ command: 'pnpm -F consumer check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		!findings.some((finding) => finding.check === StructuralCheck.ScriptExists),
		`existing script behind -F must not be flagged, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: a genuinely missing script behind --filter … run is still flagged', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'filter-run-missing.md', body: verificationPlan({ command: 'pnpm --filter consumer run nope' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.ScriptExists && finding.issue.includes("'nope'")),
		`missing script must be flagged by name, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: `yarn <script>` resolves the bare script name', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'yarn-missing.md', body: verificationPlan({ command: 'yarn build' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.ScriptExists && finding.issue.includes("'build'")),
		`the yarn script name must be flagged by name, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: a flag directly after `yarn` resolves no script — the command is left alone', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'yarn-flag.md', body: verificationPlan({ command: 'yarn --cwd sub check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.ScriptExists),
		[],
		'an unparseable yarn form is skipped, never guessed into a finding',
	);
});

test('lintPlanStructure: a raw command with no package-manager prefix is never flagged', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'raw-command.md', body: verificationPlan({ command: 'tsc --noEmit' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.ScriptExists),
		[],
		'a raw command is not a package script and must not be guessed into a finding',
	);
});

test('lintPlanStructure: a config full-command override is skipped even when it names no package script', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const config = LightsoutConfig.parse({ scripts: { check: 'pnpm ghost-script', testUnit: 'true', testCoverage: false } });
	const path = writePlan({ cwd, name: 'config-override.md', body: verificationPlan({ command: 'pnpm ghost-script' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path], config });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.ScriptExists),
		[],
		'a command the config declares verbatim is an override, not a package script',
	);
});

/** A plan whose only lint-relevant content is one modify path and one verification command. */
const packagePlan = ({ modifyPath, command }: { modifyPath: string; command: string }) => `# Plan

## Prerequisites

- None

## Global Constraints

- None

## Files to Modify

### \`${modifyPath}\`

Change something.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`${command}\` — gates green

## What Next Plan Expects

None.
`;

test('lintPlanStructure: a script living only in a target package manifest resolves', async () => {
	const cwd = setupConsumerRepo();

	mkdirSync(join(cwd, 'packages', 'api', 'src'), { recursive: true });
	writeFileSync(join(cwd, 'packages', 'api', 'src', 'thing.ts'), 'export const thing = 1;\n');
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));
	writeFileSync(join(cwd, 'packages', 'api', 'package.json'), JSON.stringify({ name: 'api', scripts: { build: 'true' } }));

	const body = packagePlan({ modifyPath: 'packages/api/src/thing.ts', command: 'pnpm build' });
	const path = writePlan({ cwd, name: 'package-script.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.ScriptExists),
		[],
		'the package named by a modify path contributes its scripts',
	);
});

test('lintPlanStructure: an unparseable package.json contributes no scripts instead of throwing', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), '{ not json');

	const path = writePlan({ cwd, name: 'corrupt-manifest.md', body: verificationPlan({ command: 'pnpm check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.ScriptExists && finding.issue.includes("'check'")),
		`the script resolves against no manifest and is flagged, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: a path directly under packages/ with no package segment is flagged', async () => {
	const cwd = setupConsumerRepo();

	const body = packagePlan({ modifyPath: 'packages/loose.ts', command: 'true' });
	const path = writePlan({ cwd, name: 'loose-package-path.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some(
			(finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes("'packages/loose.ts'"),
		),
		`the unidentifiable package path is flagged, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: a configured packagesDir moves the package-segment check off the default', async () => {
	const cwd = setupConsumerRepo();

	const config = LightsoutConfig.parse({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, packagesDir: 'modules' });
	const body = packagePlan({ modifyPath: 'modules/loose.ts', command: 'true' });
	const path = writePlan({ cwd, name: 'custom-packages-dir.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path], config });

	assert.ok(
		findings.some(
			(finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes('directly under modules/'),
		),
		`the configured packages directory drives the check, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: Phases plus Cross-Phase Dependencies make a plan overview without an Overview title', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'phased-plan.md',
		body: `# Big Change

## Phases

| # | File | Scope |
|---|------|-------|
| 1 | \`phase1-core.md\` | the core |

## Cross-Phase Dependencies

- None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });
	const sections = findings.filter((finding) => finding.check === StructuralCheck.SectionsPresent);

	assert.deepEqual(
		sections.map((finding) => finding.issue),
		["missing required section '## Global Constraints' (overview plan)"],
		'only the overview section set is required — the implementable-only sections are not',
	);
});

test('lintPlanStructure: an overview.md basename is the overview variant on its own', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'overview.md',
		body: `# Plain Title

## Global Constraints

- None
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });
	const sections = findings.filter((finding) => finding.check === StructuralCheck.SectionsPresent);

	assert.deepEqual(
		sections.map((finding) => finding.issue),
		[
			"missing required section '## Phases' (overview plan)",
			"missing required section '## Cross-Phase Dependencies' (overview plan)",
		],
		'the filename alone selects the overview section set',
	);
});

test('lintPlanStructure: a `###` path in a later section is not a Files-to-Create path', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'create-section-scope.md',
		body: `${cleanPlan()}
## Notes

### \`src/index.js\`

Background reading — not a file this plan creates.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.PathExists),
		[],
		'the create-path scan closes at the next `##` heading',
	);
});

test('lintPlanStructure: a create heading whose first code span is not a path falls through to the path span', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'second-span-path.md',
		body: cleanPlan().replace('### `src/new-thing.ts`', '### `oneConst` in `src/index.js`'),
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some(
			(finding) => finding.check === StructuralCheck.PathExists && finding.issue === 'Files to Create path already exists: src/index.js',
		),
		`the path-shaped span is the create path, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: a create heading with no path-shaped code span contributes no create path', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-path-span.md',
		body: cleanPlan().replace('### `src/new-thing.ts`', '### `newThing`'),
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(
		findings.filter((finding) => finding.check === StructuralCheck.PathExists),
		[],
		'a bare symbol name is not a path and is never stat-ed',
	);
});
