import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { readStandards } from '@/standards';

/** A temp consumer repo holding the given repo-relative files — the entries a config can declare. */
const setupRepo = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-standards-'));

	for (const [path, content] of Object.entries(files)) {
		const absolutePath = join(cwd, path);

		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, content);
	}

	return { cwd };
};

describe('readStandards', () => {
	test('returns undefined when the consumer declares no standards', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd, paths: [] });

		assert.equal(standards, undefined, 'no entries means nothing to inline — not an empty string');
	});

	test('reads a declared file under a header naming the entry as written', async () => {
		const { cwd } = setupRepo({ files: { 'docs/style.md': '# Style\nuse tabs\n' } });

		const standards = await readStandards({ cwd, paths: ['docs/style.md'] });

		assert.equal(standards, '<!-- docs/style.md -->\n# Style\nuse tabs\n');
	});

	test('joins declared entries in the order written rather than sorting them', async () => {
		const { cwd } = setupRepo({ files: { 'zeta.md': 'zeta\n', 'alpha.md': 'alpha\n' } });

		const standards = await readStandards({ cwd, paths: ['zeta.md', 'alpha.md'] });

		assert.equal(standards, '<!-- zeta.md -->\nzeta\n\n\n<!-- alpha.md -->\nalpha\n');
	});

	test('reads every markdown file under a declared folder, recursively, in sorted path order', async () => {
		const { cwd } = setupRepo({
			files: {
				'rules/zeta.md': 'zeta\n',
				'rules/alpha.md': 'alpha\n',
				'rules/nested/beta.md': 'beta\n',
				'rules/notes.txt': 'not markdown\n',
			},
		});

		const standards = await readStandards({ cwd, paths: ['rules'] });

		assert.equal(
			standards,
			[
				'<!-- rules/alpha.md -->\nalpha\n',
				'<!-- rules/nested/beta.md -->\nbeta\n',
				'<!-- rules/zeta.md -->\nzeta\n',
			].join('\n\n'),
			'sorted display paths, nested files included, non-markdown left out',
		);
	});

	test('strips a trailing slash from a declared folder so each header names its file once', async () => {
		const { cwd } = setupRepo({ files: { 'rules/alpha.md': 'alpha\n' } });

		const standards = await readStandards({ cwd, paths: ['rules/'] });

		assert.equal(standards, '<!-- rules/alpha.md -->\nalpha\n');
	});

	test('neither follows nor collects symlinks inside a declared folder', async () => {
		const { cwd } = setupRepo({ files: { 'rules/real.md': 'real\n', 'outside/linked.md': 'linked\n' } });

		symlinkSync(join(cwd, 'outside/linked.md'), join(cwd, 'rules/link.md'));
		symlinkSync(join(cwd, 'outside'), join(cwd, 'rules/nested'));

		const standards = await readStandards({ cwd, paths: ['rules'] });

		assert.equal(standards, '<!-- rules/real.md -->\nreal\n', "the walk matches the generator's find — real files only");
	});

	test('rejects a declared entry that is missing from the repo, naming the absolute path', async () => {
		const { cwd } = setupRepo({ files: { 'docs/style.md': '# Style\n' } });

		await assert.rejects(readStandards({ cwd, paths: ['docs/style.md', 'docs/missing.md'] }), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /standards file not found/);
			assert.ok(
				error.message.includes(join(cwd, 'docs/missing.md')),
				`the message names the path the consumer must author, got: ${error.message}`,
			);

			return true;
		});
	});

	test('rejects a declared folder holding no markdown at all', async () => {
		const { cwd } = setupRepo({ files: { 'rules/notes.txt': 'not markdown\n' } });

		await assert.rejects(readStandards({ cwd, paths: ['rules'] }), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /standards folder contains no markdown files/);
			assert.ok(error.message.includes(join(cwd, 'rules')), `the message names the empty folder, got: ${error.message}`);

			return true;
		});
	});

	test('expands a bundled token to its base channel docs when no channels are active', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd, paths: ['lightsout:code-defaults'] });

		assert.ok(
			standards?.includes('<!-- lightsout defaults: standards/code/architecture/folder-structure.md -->'),
			'base docs always apply',
		);
		assert.ok(!standards?.includes('react-components.md'), 'react docs stay out without the channel');
		assert.ok(!standards?.includes('tanstack-start'), 'tanstack docs stay out without the channel');
	});

	test('appends the docs of each active channel after the base docs', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd, paths: ['lightsout:code-defaults'], channels: ['react', 'tanstack'] });

		assert.ok(
			standards?.includes('<!-- lightsout defaults: standards/code/style-guide/patterns/react-components.md -->'),
			'react channel docs present',
		);
		assert.ok(
			standards?.includes('<!-- lightsout defaults: standards/code/architecture/tanstack-start/architecture-decisions.md -->'),
			'tanstack channel docs present',
		);
		assert.ok(
			(standards?.indexOf('<!-- lightsout defaults: standards/code/architecture/folder-structure.md -->') ?? -1) <
				(standards?.indexOf('<!-- lightsout defaults: standards/code/style-guide/patterns/react-components.md -->') ?? -1),
			'base docs precede channel docs',
		);
	});

	test('drops an active channel the token defines no docs for', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd, paths: ['lightsout:test-defaults'], channels: ['vue'] });

		assert.ok(
			standards?.includes('<!-- lightsout defaults: standards/tests/unit/jest/unit-testing.md -->'),
			'base docs still expand',
		);
		assert.ok(!standards?.includes('unit-testing-react-components.md'), 'an unknown channel contributes no docs');
		assert.ok(!standards?.endsWith('\n\n'), 'the unknown channel is dropped, not joined in as a blank block');
	});

	test('resolves a bundled token without reading the repo', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd: join(cwd, 'does-not-exist'), paths: ['lightsout:test-defaults'] });

		assert.ok(
			standards?.includes('<!-- lightsout defaults: standards/tests/unit/jest/unit-testing.md -->'),
			'tokens are bundled docs — a missing cwd never reaches the filesystem',
		);
	});

	test('composes bundled tokens and repo files into one document in the declared order', async () => {
		const { cwd } = setupRepo({ files: { 'docs/local.md': '# Local\n' } });

		const standards = await readStandards({ cwd, paths: ['lightsout:test-defaults', 'docs/local.md'] });

		assert.ok(standards?.includes('standards/tests/unit/jest/unit-testing.md'), 'the token expanded');
		assert.ok(standards?.endsWith('\n\n<!-- docs/local.md -->\n# Local\n'), 'the repo file follows the token, separated by a blank line');
	});
});
