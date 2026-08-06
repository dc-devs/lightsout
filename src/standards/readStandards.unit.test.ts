import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { readStandards } from '@/standards';
import { getRejectionError } from '@tests/helpers/getRejectionError';

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

		// no entries means nothing to inline — not an empty string
		expect(standards).toBe(undefined);
	});

	test('reads a declared file under a header naming the entry as written', async () => {
		const { cwd } = setupRepo({ files: { 'docs/style.md': '# Style\nuse tabs\n' } });

		const standards = await readStandards({ cwd, paths: ['docs/style.md'] });

		expect(standards).toBe('<!-- docs/style.md -->\n# Style\nuse tabs\n');
	});

	test('joins declared entries in the order written rather than sorting them', async () => {
		const { cwd } = setupRepo({ files: { 'zeta.md': 'zeta\n', 'alpha.md': 'alpha\n' } });

		const standards = await readStandards({ cwd, paths: ['zeta.md', 'alpha.md'] });

		expect(standards).toBe('<!-- zeta.md -->\nzeta\n\n\n<!-- alpha.md -->\nalpha\n');
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

		// sorted display paths, nested files included, non-markdown left out
		expect(standards).toBe([
			'<!-- rules/alpha.md -->\nalpha\n',
			'<!-- rules/nested/beta.md -->\nbeta\n',
			'<!-- rules/zeta.md -->\nzeta\n',
		].join('\n\n'));
	});

	test('strips a trailing slash from a declared folder so each header names its file once', async () => {
		const { cwd } = setupRepo({ files: { 'rules/alpha.md': 'alpha\n' } });

		const standards = await readStandards({ cwd, paths: ['rules/'] });

		expect(standards).toBe('<!-- rules/alpha.md -->\nalpha\n');
	});

	test('neither follows nor collects symlinks inside a declared folder', async () => {
		const { cwd } = setupRepo({ files: { 'rules/real.md': 'real\n', 'outside/linked.md': 'linked\n' } });

		symlinkSync(join(cwd, 'outside/linked.md'), join(cwd, 'rules/link.md'));
		symlinkSync(join(cwd, 'outside'), join(cwd, 'rules/nested'));

		const standards = await readStandards({ cwd, paths: ['rules'] });

		// the walk matches the generator's find — real files only
		expect(standards).toBe('<!-- rules/real.md -->\nreal\n');
	});

	test('rejects a declared entry that is missing from the repo, naming the absolute path', async () => {
		const { cwd } = setupRepo({ files: { 'docs/style.md': '# Style\n' } });

		const error = await getRejectionError({ promise: readStandards({ cwd, paths: ['docs/style.md', 'docs/missing.md'] }) });

		expect(error.message).toMatch(/standards file not found/);
		// the message names the path the consumer must author
		expect(error.message).toContain(join(cwd, 'docs/missing.md'));
	});

	test('rejects a declared folder holding no markdown at all', async () => {
		const { cwd } = setupRepo({ files: { 'rules/notes.txt': 'not markdown\n' } });

		const error = await getRejectionError({ promise: readStandards({ cwd, paths: ['rules'] }) });

		expect(error.message).toMatch(/standards folder contains no markdown files/);
		// the message names the empty folder
		expect(error.message).toContain(join(cwd, 'rules'));
	});

	test('expands a bundled token to its base channel docs when no channels are active', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd, paths: ['lightsout:code-defaults'] });

		// base docs always apply
		expect(standards?.includes('<!-- lightsout defaults: standards/code/architecture/folder-structure.md -->')).toBeTruthy();
		// react docs stay out without the channel
		expect(standards?.includes('react-components.md')).toBeFalsy();
		// tanstack docs stay out without the channel
		expect(standards?.includes('tanstack-start')).toBeFalsy();
	});

	test('appends the docs of each active channel after the base docs', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd, paths: ['lightsout:code-defaults'], channels: ['react', 'tanstack'] });

		// react channel docs present
		expect(standards?.includes('<!-- lightsout defaults: standards/code/style-guide/patterns/react-components.md -->')).toBeTruthy();
		// tanstack channel docs present
		expect(standards?.includes('<!-- lightsout defaults: standards/code/architecture/tanstack-start/architecture-decisions.md -->')).toBeTruthy();
		// base docs precede channel docs
		expect((standards?.indexOf('<!-- lightsout defaults: standards/code/architecture/folder-structure.md -->') ?? -1) <
			(standards?.indexOf('<!-- lightsout defaults: standards/code/style-guide/patterns/react-components.md -->') ?? -1)).toBeTruthy();
	});

	test('drops an active channel the token defines no docs for', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd, paths: ['lightsout:test-defaults'], channels: ['vue'] });

		// base docs still expand
		expect(standards?.includes('<!-- lightsout defaults: standards/tests/unit/jest/unit-testing.md -->')).toBeTruthy();
		// an unknown channel contributes no docs
		expect(standards?.includes('unit-testing-react-components.md')).toBeFalsy();
		// the unknown channel is dropped, not joined in as a blank block
		expect(standards?.endsWith('\n\n')).toBeFalsy();
	});

	test('resolves a bundled token without reading the repo', async () => {
		const { cwd } = setupRepo();

		const standards = await readStandards({ cwd: join(cwd, 'does-not-exist'), paths: ['lightsout:test-defaults'] });

		// tokens are bundled docs — a missing cwd never reaches the filesystem
		expect(standards?.includes('<!-- lightsout defaults: standards/tests/unit/jest/unit-testing.md -->')).toBeTruthy();
	});

	test('composes bundled tokens and repo files into one document in the declared order', async () => {
		const { cwd } = setupRepo({ files: { 'docs/local.md': '# Local\n' } });

		const standards = await readStandards({ cwd, paths: ['lightsout:test-defaults', 'docs/local.md'] });

		// the token expanded
		expect(standards?.includes('standards/tests/unit/jest/unit-testing.md')).toBeTruthy();
		// the repo file follows the token, separated by a blank line
		expect(standards?.endsWith('\n\n<!-- docs/local.md -->\n# Local\n')).toBeTruthy();
	});
});
