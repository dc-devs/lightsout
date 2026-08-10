import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { LightsoutConfig, StructuralCheck } from '@/contracts';
import { lintPlanStructure } from '@/plan';

/** Write a plan file into a plan's own folder and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

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

	// the missing modify path is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('src/does-not-exist.ts'))).toBeTruthy();
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

	// the create path that exists is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('already exists'))).toBeTruthy();
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

	// a mirror target is stated as existing code — a missing one is the same
	// defect as a missing modify path
	expect(findings.filter((finding) => finding.check === StructuralCheck.PathExists)).toStrictEqual([
		{
			check: StructuralCheck.PathExists,
			issue: 'referenced path does not exist: src/gone.ts',
			location: 'missing-mirror.md → src/gone.ts',
			fix: 'correct the path or move it under Files to Create if it does not exist yet',
		},
	]);
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

	expect(findings.filter((finding) => finding.check === StructuralCheck.PathExists)).toStrictEqual([
		{
			check: StructuralCheck.PathExists,
			issue: 'Files to Create path already exists: src/index.js',
			location: 'create-exists-detail.md → src/index.js',
			fix: 'move it to Files to Modify, or choose a new path',
		},
	]);
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

	// the TBD is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders)).toBeTruthy();
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

	// the missing section is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('What Next Plan Expects'))).toBeTruthy();
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

	// the missing section is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('Global Constraints'))).toBeTruthy();
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

	// the missing section is flagged on the overview variant
	expect(
		findings.some(
			(finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('Global Constraints') && finding.issue.includes('overview'),
		),
	).toBeTruthy();
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

	// the oversized plan is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.ScopeWithinGuardrail)).toBeTruthy();
});

test('lintPlanStructure: a clean plan returns no findings', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'clean.md', body: cleanPlan() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// clean plan should have no findings, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
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

	// a fenced interpolation must not be flagged, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});

test('lintPlanStructure: a template-literal interpolation in prose is not a placeholder — the lookbehind covers it outside fences', async () => {
	const findings = await placeholderFindings({
		name: 'prose-interpolation.md',
		snippet: 'The writer interpolates `hi ${userName}` into the greeting.',
	});

	// a prose interpolation must not be flagged, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});

test('lintPlanStructure: destructuring inside a fenced block is not a placeholder', async () => {
	const findings = await placeholderFindings({
		name: 'fenced-destructuring.md',
		snippet: '```tsx\nconst {userName} = props;\n\nreturn <span>{userName}</span>;\n```',
	});

	// fenced code braces must not be flagged, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});

test('lintPlanStructure: a bare brace-token in prose is still flagged', async () => {
	const findings = await placeholderFindings({ name: 'prose-token.md', snippet: 'Resolve the {token} before writing.' });

	// the prose brace-token is flagged, got: ${JSON.stringify(findings)}
	expect(findings.length).toBe(1);
});

test('lintPlanStructure: a brace-token in an inline code span is still flagged — fences only, never spans', async () => {
	const findings = await placeholderFindings({ name: 'span-token.md', snippet: 'Place it at `packages/{package}/src/thing.ts`.' });

	// the inline-span brace-token is flagged, got: ${JSON.stringify(findings)}
	expect(findings.length).toBe(1);
});

test('lintPlanStructure: a TODO inside a fenced block is still flagged — fences suppress only the brace-token', async () => {
	const findings = await placeholderFindings({ name: 'fenced-todo.md', snippet: '```ts\n// TODO: decide later\n```' });

	// the fenced TODO is flagged, got: ${JSON.stringify(findings)}
	expect(findings.length).toBe(1);
});

test('lintPlanStructure: fence state resets per file — an unclosed fence never silences the next plan', async () => {
	const cwd = setupConsumerRepo();
	const unclosed = writePlan({ cwd, name: 'unclosed-fence.md', body: planWith({ snippet: '```ts\nconst {userName} = props;' }) });
	const following = writePlan({ cwd, name: 'after-fence.md', body: planWith({ snippet: 'Resolve the {token} before writing.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [unclosed, following] });
	const placeholders = findings.filter((finding) => finding.check === StructuralCheck.NoPlaceholders);

	// only the second plan's prose token is flagged, got:
	// ${JSON.stringify(placeholders)}
	expect(placeholders.length).toBe(1);
	// the finding is attributed to the second plan
	expect(placeholders[0].location.startsWith('after-fence.md:')).toBeTruthy();
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

	// existing script behind --filter … run must not be flagged, got:
	// ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.ScriptExists)).toBeFalsy();
});

test('lintPlanStructure: `pnpm -F <pkg> <script>` resolves the script, not the flag', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'short-filter.md', body: verificationPlan({ command: 'pnpm -F consumer check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// existing script behind -F must not be flagged, got:
	// ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.ScriptExists)).toBeFalsy();
});

test('lintPlanStructure: a genuinely missing script behind --filter … run is still flagged', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'filter-run-missing.md', body: verificationPlan({ command: 'pnpm --filter consumer run nope' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// missing script must be flagged by name, got: ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.ScriptExists && finding.issue.includes("'nope'"))).toBeTruthy();
});

test('lintPlanStructure: `yarn <script>` resolves the bare script name', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'yarn-missing.md', body: verificationPlan({ command: 'yarn build' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the yarn script name must be flagged by name, got:
	// ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.ScriptExists && finding.issue.includes("'build'"))).toBeTruthy();
});

test('lintPlanStructure: a flag directly after `yarn` resolves no script — the command is left alone', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'yarn-flag.md', body: verificationPlan({ command: 'yarn --cwd sub check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// an unparseable yarn form is skipped, never guessed into a finding
	expect(findings.filter((finding) => finding.check === StructuralCheck.ScriptExists)).toStrictEqual([]);
});

test('lintPlanStructure: a raw command with no package-manager prefix is never flagged', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'raw-command.md', body: verificationPlan({ command: 'tsc --noEmit' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// a raw command is not a package script and must not be guessed into a finding
	expect(findings.filter((finding) => finding.check === StructuralCheck.ScriptExists)).toStrictEqual([]);
});

test('lintPlanStructure: a config full-command override is skipped even when it names no package script', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const config = LightsoutConfig.parse({ scripts: { check: 'pnpm ghost-script', testUnit: 'true', testCoverage: false } });
	const path = writePlan({ cwd, name: 'config-override.md', body: verificationPlan({ command: 'pnpm ghost-script' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path], config });

	// a command the config declares verbatim is an override, not a package script
	expect(findings.filter((finding) => finding.check === StructuralCheck.ScriptExists)).toStrictEqual([]);
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

	// the package named by a modify path contributes its scripts
	expect(findings.filter((finding) => finding.check === StructuralCheck.ScriptExists)).toStrictEqual([]);
});

test('lintPlanStructure: an unparseable package.json contributes no scripts instead of throwing', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), '{ not json');

	const path = writePlan({ cwd, name: 'corrupt-manifest.md', body: verificationPlan({ command: 'pnpm check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the script resolves against no manifest and is flagged, got:
	// ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.ScriptExists && finding.issue.includes("'check'"))).toBeTruthy();
});

test('lintPlanStructure: a path directly under packages/ with no package segment is flagged', async () => {
	const cwd = setupConsumerRepo();

	const body = packagePlan({ modifyPath: 'packages/loose.ts', command: 'true' });
	const path = writePlan({ cwd, name: 'loose-package-path.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the unidentifiable package path is flagged, got: ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes("'packages/loose.ts'"))).toBeTruthy();
});

test('lintPlanStructure: a configured packagesDir moves the package-segment check off the default', async () => {
	const cwd = setupConsumerRepo();

	const config = LightsoutConfig.parse({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, packagesDir: 'modules' });
	const body = packagePlan({ modifyPath: 'modules/loose.ts', command: 'true' });
	const path = writePlan({ cwd, name: 'custom-packages-dir.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path], config });

	// the configured packages directory drives the check, got:
	// ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes('directly under modules/'))).toBeTruthy();
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

	// only the overview section set is required — the implementable-only sections
	// are not
	expect(sections.map((finding) => finding.issue)).toStrictEqual(["missing required section '## Global Constraints' (overview plan)"]);
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

	// the filename alone selects the overview section set
	expect(sections.map((finding) => finding.issue)).toStrictEqual([
		"missing required section '## Phases' (overview plan)",
		"missing required section '## Cross-Phase Dependencies' (overview plan)",
	]);
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

	// the create-path scan closes at the next `##` heading
	expect(findings.filter((finding) => finding.check === StructuralCheck.PathExists)).toStrictEqual([]);
});

test('lintPlanStructure: a create heading whose first code span is not a path falls through to the path span', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'second-span-path.md',
		body: cleanPlan().replace('### `src/new-thing.ts`', '### `oneConst` in `src/index.js`'),
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the path-shaped span is the create path, got: ${JSON.stringify(findings)}
	expect(
		findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue === 'Files to Create path already exists: src/index.js'),
	).toBeTruthy();
});

test('lintPlanStructure: a create heading with no path-shaped code span contributes no create path', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-path-span.md',
		body: cleanPlan().replace('### `src/new-thing.ts`', '### `newThing`'),
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// a bare symbol name is not a path and is never stat-ed
	expect(findings.filter((finding) => finding.check === StructuralCheck.PathExists)).toStrictEqual([]);
});

test('lintPlanStructure: a plan file that cannot be read is a finding, not a silent pass', async () => {
	const cwd = setupConsumerRepo();
	const planPath = join(cwd, 'unreadable-plan.md');

	// a directory standing where the plan should be: the draft claimed a path
	// that holds no text, and a clean lint would let that through as structural
	mkdirSync(planPath);

	const findings = await lintPlanStructure({ cwd, planPaths: [planPath] });

	expect(findings.map(({ issue, location }) => ({ issue, location }))).toStrictEqual([{ issue: 'plan file could not be read', location: planPath }]);
	expect(findings[0]?.fix).toMatch(/ensure the draft wrote the plan file/);
});
