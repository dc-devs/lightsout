import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanFacts } from '#src/contracts/index.ts';
import { runPlanVerifyFacts } from '#src/plan/runPlanVerifyFacts.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** Seed the workspace's authored facts.json with the given raw content. */
const seedFacts = ({ cwd, name, content }: { cwd: string; name: string; content: string }) => {
	const dir = planWorkspaceFolder({ cwd: cwd, name: name });

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'facts.json'), content);
};

/** A valid authored `{ request, areas }`: a real path, optionally a ghost path, and a script. */
const authoredFacts = ({ ghost = true }: { ghost?: boolean } = {}) =>
	JSON.stringify({
		request: 'add a foo endpoint',
		areas: [
			{
				area: 'core',
				affectedPackages: [],
				filesToModify: [{ path: 'src/index.js', role: 'the entry point' }, ...(ghost ? [{ path: 'src/does-not-exist.ts', role: 'a ghost file' }] : [])],
				patternsToMirror: [],
				integrationPoints: [],
				scripts: [{ key: 'check', command: 'tsc' }],
				namingConvention: 'kebab',
			},
		],
	});

test('plan verify-facts: stamps authored facts with the on-disk verification', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'stamp-me', content: authoredFacts() });

	const result = await runPlanVerifyFacts({ cwd, name: 'stamp-me' });

	expectStatus(result, 'complete');
	expect('factsPath' in result).toBeTruthy();
	expect(result.factsPath).toBe(join(cwd, '.lightsout', 'work-orders', 'stamp-me', 'plans', 'facts.json'));

	const facts = PlanFacts.parse(JSON.parse(readFileSync(result.factsPath, 'utf8')));

	expect(facts.request).toBe('add a foo endpoint');
	// the ghost path is flagged, the real one is not
	expect(facts.verification.missingPaths).toStrictEqual(['src/does-not-exist.ts']);
	// 'check' resolves against package.json
	expect(facts.verification.missingScripts).toStrictEqual([]);
	expect(facts.verification.pathsChecked).toBe(2);
	// verifiedAt is an ISO timestamp
	expect(Number.isNaN(Date.parse(facts.verifiedAt))).toBeFalsy();
});

test('plan verify-facts: a missing facts.json fails and writes nothing', async () => {
	const cwd = setupConsumerRepo();
	const result = await runPlanVerifyFacts({ cwd, name: 'unauthored' });

	expectStatus(result, 'failed');
	expect('error' in result && /no authored facts/.test(result.error ?? '')).toBeTruthy();
	// no facts.json written on failure
	expect(existsSync(join(cwd, '.lightsout', 'work-orders', 'unauthored', 'plans', 'facts.json'))).toBeFalsy();
});

test('plan verify-facts: an unparsable facts.json fails and is left untouched', async () => {
	const cwd = setupConsumerRepo();

	seedFacts({ cwd, name: 'bad-shape', content: '{"request": 42}' });

	const result = await runPlanVerifyFacts({ cwd, name: 'bad-shape' });

	expectStatus(result, 'failed');
	// the invalid file is untouched
	expect(readFileSync(join(cwd, '.lightsout', 'work-orders', 'bad-shape', 'plans', 'facts.json'), 'utf8')).toBe('{"request": 42}');
});

test('plan verify-facts: narrates the summary without a missing list when every path exists', async () => {
	const cwd = setupConsumerRepo();
	const messages: string[] = [];

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'all-present', content: authoredFacts({ ghost: false }) });

	const result = await runPlanVerifyFacts({ cwd, name: 'all-present', onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	// one summary line per run
	expect(messages.length).toBe(1);
	// no missing-paths list when nothing is missing
	expect(messages.join('\n')).toMatch(/1 path\(s\) verified; 1 script\(s\) checked/);
});

test('plan verify-facts: narrates the missing paths in the summary line', async () => {
	const cwd = setupConsumerRepo();
	const messages: string[] = [];

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'some-missing', content: authoredFacts() });

	const result = await runPlanVerifyFacts({ cwd, name: 'some-missing', onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	// the ghost path is named in the summary
	expect(messages.join('\n')).toMatch(/1 missing: src\/does-not-exist\.ts/);
});

test('plan verify-facts: --notes freezes a copy of the notes file into the workspace', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	writeFileSync(join(cwd, 'rough-brainstorm-notes.md'), '# Rough notes\n\nThe idea in the user words.\n');
	seedFacts({ cwd, name: 'with-notes', content: authoredFacts() });

	const result = await runPlanVerifyFacts({ cwd, name: 'with-notes', notesFile: 'rough-brainstorm-notes.md' });

	expectStatus(result, 'complete');
	// the snapshot equals the source content
	expect(readFileSync(join(cwd, '.lightsout', 'work-orders', 'with-notes', 'plans', 'brainstorm-notes.md'), 'utf8')).toBe(
		'# Rough notes\n\nThe idea in the user words.\n',
	);
});

test('plan verify-facts: an existing brainstorm-notes.md snapshot is never overwritten', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	writeFileSync(join(cwd, 'rough-brainstorm-notes.md'), 'newer notes that must not land\n');
	seedFacts({ cwd, name: 'frozen', content: authoredFacts() });
	writeFileSync(join(cwd, '.lightsout', 'work-orders', 'frozen', 'plans', 'brainstorm-notes.md'), 'the original frozen notes\n');

	const result = await runPlanVerifyFacts({ cwd, name: 'frozen', notesFile: 'rough-brainstorm-notes.md' });

	expectStatus(result, 'complete');
	// the first copy wins — the snapshot is write-once
	expect(readFileSync(join(cwd, '.lightsout', 'work-orders', 'frozen', 'plans', 'brainstorm-notes.md'), 'utf8')).toBe('the original frozen notes\n');
});

test('plan verify-facts: a missing notes source fails and names the resolved path', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'no-source', content: authoredFacts() });

	const result = await runPlanVerifyFacts({ cwd, name: 'no-source', notesFile: 'ghost-brainstorm-notes.md' });

	expectStatus(result, 'failed');
	// the error names the resolved source, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes(join(cwd, 'ghost-brainstorm-notes.md'))).toBeTruthy();
	// no brainstorm-notes.md written on failure
	expect(existsSync(join(cwd, '.lightsout', 'work-orders', 'no-source', 'plans', 'brainstorm-notes.md'))).toBeFalsy();
});

test('plan verify-facts: the notes freeze even when the authored facts are missing', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'rough-brainstorm-notes.md'), 'notes that must freeze first\n');

	const result = await runPlanVerifyFacts({ cwd, name: 'notes-first', notesFile: 'rough-brainstorm-notes.md' });

	expectStatus(result, 'failed');
	expect('error' in result && /no authored facts/.test(result.error ?? '')).toBeTruthy();
	// the snapshot is the plan first artifact — it lands before the facts read
	expect(readFileSync(join(cwd, '.lightsout', 'work-orders', 'notes-first', 'plans', 'brainstorm-notes.md'), 'utf8')).toBe('notes that must freeze first\n');
});

test('plan verify-facts: re-running on a stamped file re-verifies and re-stamps', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'again', content: authoredFacts() });

	const first = await runPlanVerifyFacts({ cwd, name: 'again' });

	expectStatus(first, 'complete');
	expect('facts' in first).toBeTruthy();
	expect(first.facts.verification.missingPaths).toStrictEqual(['src/does-not-exist.ts']);

	// The ghost file appears between runs — the re-run must re-check the disk,
	// not re-stamp the first run's verification.
	writeFileSync(join(cwd, 'src', 'does-not-exist.ts'), '');

	const second = await runPlanVerifyFacts({ cwd, name: 'again' });

	expectStatus(second, 'complete');

	const restamped = PlanFacts.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'work-orders', 'again', 'plans', 'facts.json'), 'utf8')));

	// the second run re-verified against the current disk
	expect(restamped.verification.missingPaths).toStrictEqual([]);
	// the authored request survives the re-stamp
	expect(restamped.request).toBe('add a foo endpoint');
});

/**
 * A primary checkout with a linked worktree cut from it, the plan's authored
 * facts seeded in the primary's plan folder — the shape a plan command runs in
 * whenever `plan.worktree` moves the session into a tree.
 */
const setupWorktreeSession = ({ name }: { name: string }) => {
	const { cwd } = setupBranchRepo();
	const primary = realpathSync(cwd);
	const worktree = join(primary, '.worktrees', name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	seedFacts({ cwd: primary, name, content: authoredFacts({ ghost: false }) });

	return { primary, worktree };
};

test("facts are written into the primary checkout's plan folder when the command runs in a worktree", async () => {
	const { primary, worktree } = setupWorktreeSession({ name: 'worktree-session' });

	const result = await runPlanVerifyFacts({ cwd: worktree, name: 'worktree-session' });

	expectStatus(result, 'complete');
	// the stamped file is the primary checkout's, whichever checkout the command ran in
	expect(result.factsPath).toBe(join(primary, '.lightsout', 'work-orders', 'worktree-session', 'plans', 'facts.json'));

	const stamped = PlanFacts.parse(JSON.parse(readFileSync(join(primary, '.lightsout', 'work-orders', 'worktree-session', 'plans', 'facts.json'), 'utf8')));

	expect(stamped.request).toBe('add a foo endpoint');
	// a plan folder in a tree that gets removed would take the plan with it
	expect(existsSync(join(worktree, '.lightsout', 'work-orders'))).toBeFalsy();
});
