import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PlanFacts } from '@/contracts';
import { runPlanVerifyFacts } from '@/plan';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Seed the workspace's authored facts.json with the given raw content. */
const seedFacts = ({ cwd, name, content }: { cwd: string; name: string; content: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

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
				filesToModify: [
					{ path: 'src/index.js', role: 'the entry point' },
					...(ghost ? [{ path: 'src/does-not-exist.ts', role: 'a ghost file' }] : []),
				],
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

	assert.equal(result.status, 'complete', result.error);
	assert.ok('factsPath' in result);
	assert.equal(result.factsPath, join(cwd, '.lightsout', 'plans', 'stamp-me', 'facts.json'));

	const facts = PlanFacts.parse(JSON.parse(readFileSync(result.factsPath, 'utf8')));

	assert.equal(facts.request, 'add a foo endpoint');
	assert.deepEqual(facts.verification.missingPaths, ['src/does-not-exist.ts'], 'the ghost path is flagged, the real one is not');
	assert.deepEqual(facts.verification.missingScripts, [], "'check' resolves against package.json");
	assert.equal(facts.verification.pathsChecked, 2);
	assert.ok(!Number.isNaN(Date.parse(facts.verifiedAt)), 'verifiedAt is an ISO timestamp');
});

test('plan verify-facts: a missing facts.json fails and writes nothing', async () => {
	const cwd = setupConsumerRepo();
	const result = await runPlanVerifyFacts({ cwd, name: 'unauthored' });

	assert.equal(result.status, 'failed');
	assert.ok('error' in result && /no authored facts/.test(result.error ?? ''), result.error);
	assert.ok(!existsSync(join(cwd, '.lightsout', 'plans', 'unauthored', 'facts.json')), 'no facts.json written on failure');
});

test('plan verify-facts: an unparsable facts.json fails and is left untouched', async () => {
	const cwd = setupConsumerRepo();

	seedFacts({ cwd, name: 'bad-shape', content: '{"request": 42}' });

	const result = await runPlanVerifyFacts({ cwd, name: 'bad-shape' });

	assert.equal(result.status, 'failed');
	assert.equal(readFileSync(join(cwd, '.lightsout', 'plans', 'bad-shape', 'facts.json'), 'utf8'), '{"request": 42}', 'the invalid file is untouched');
});

test('plan verify-facts: narrates the summary without a missing list when every path exists', async () => {
	const cwd = setupConsumerRepo();
	const messages: string[] = [];

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'all-present', content: authoredFacts({ ghost: false }) });

	const result = await runPlanVerifyFacts({ cwd, name: 'all-present', onProgress: (message) => messages.push(message) });

	assert.equal(result.status, 'complete', result.error);
	assert.equal(messages.length, 1, 'one summary line per run');
	assert.match(messages.join('\n'), /1 path\(s\) verified; 1 script\(s\) checked/, 'no missing-paths list when nothing is missing');
});

test('plan verify-facts: narrates the missing paths in the summary line', async () => {
	const cwd = setupConsumerRepo();
	const messages: string[] = [];

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'some-missing', content: authoredFacts() });

	const result = await runPlanVerifyFacts({ cwd, name: 'some-missing', onProgress: (message) => messages.push(message) });

	assert.equal(result.status, 'complete', result.error);
	assert.match(messages.join('\n'), /1 missing: src\/does-not-exist\.ts/, 'the ghost path is named in the summary');
});

test('plan verify-facts: --notes freezes a copy of the notes file into the workspace', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	writeFileSync(join(cwd, 'rough-notes.md'), '# Rough notes\n\nThe idea in the user words.\n');
	seedFacts({ cwd, name: 'with-notes', content: authoredFacts() });

	const result = await runPlanVerifyFacts({ cwd, name: 'with-notes', notesFile: 'rough-notes.md' });

	assert.equal(result.status, 'complete', result.error);
	assert.equal(
		readFileSync(join(cwd, '.lightsout', 'plans', 'with-notes', 'notes.md'), 'utf8'),
		'# Rough notes\n\nThe idea in the user words.\n',
		'the snapshot equals the source content',
	);
});

test('plan verify-facts: an existing notes.md snapshot is never overwritten', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	writeFileSync(join(cwd, 'rough-notes.md'), 'newer notes that must not land\n');
	seedFacts({ cwd, name: 'frozen', content: authoredFacts() });
	writeFileSync(join(cwd, '.lightsout', 'plans', 'frozen', 'notes.md'), 'the original frozen notes\n');

	const result = await runPlanVerifyFacts({ cwd, name: 'frozen', notesFile: 'rough-notes.md' });

	assert.equal(result.status, 'complete', result.error);
	assert.equal(
		readFileSync(join(cwd, '.lightsout', 'plans', 'frozen', 'notes.md'), 'utf8'),
		'the original frozen notes\n',
		'the first copy wins — the snapshot is write-once',
	);
});

test('plan verify-facts: a missing notes source fails and names the resolved path', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'no-source', content: authoredFacts() });

	const result = await runPlanVerifyFacts({ cwd, name: 'no-source', notesFile: 'ghost-notes.md' });

	assert.equal(result.status, 'failed');
	assert.ok('error' in result && (result.error ?? '').includes(join(cwd, 'ghost-notes.md')), `the error names the resolved source, got: ${result.error}`);
	assert.ok(!existsSync(join(cwd, '.lightsout', 'plans', 'no-source', 'notes.md')), 'no notes.md written on failure');
});

test('plan verify-facts: the notes freeze even when the authored facts are missing', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'rough-notes.md'), 'notes that must freeze first\n');

	const result = await runPlanVerifyFacts({ cwd, name: 'notes-first', notesFile: 'rough-notes.md' });

	assert.equal(result.status, 'failed');
	assert.ok('error' in result && /no authored facts/.test(result.error ?? ''), result.error);
	assert.equal(
		readFileSync(join(cwd, '.lightsout', 'plans', 'notes-first', 'notes.md'), 'utf8'),
		'notes that must freeze first\n',
		'the snapshot is the plan first artifact — it lands before the facts read',
	);
});

test('plan verify-facts: re-running on a stamped file re-verifies and re-stamps', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc' } }));
	seedFacts({ cwd, name: 'again', content: authoredFacts() });

	const first = await runPlanVerifyFacts({ cwd, name: 'again' });

	assert.equal(first.status, 'complete', first.error);
	assert.ok('facts' in first);
	assert.deepEqual(first.facts.verification.missingPaths, ['src/does-not-exist.ts']);

	// The ghost file appears between runs — the re-run must re-check the disk,
	// not re-stamp the first run's verification.
	writeFileSync(join(cwd, 'src', 'does-not-exist.ts'), '');

	const second = await runPlanVerifyFacts({ cwd, name: 'again' });

	assert.equal(second.status, 'complete', second.error);

	const restamped = PlanFacts.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'again', 'facts.json'), 'utf8')));

	assert.deepEqual(restamped.verification.missingPaths, [], 'the second run re-verified against the current disk');
	assert.equal(restamped.request, 'add a foo endpoint', 'the authored request survives the re-stamp');
});
