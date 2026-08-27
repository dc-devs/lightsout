/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { listStandardsPacks } from '#src/views/index.ts';

/** Write a set of folder-relative files, creating the folders they need. */
const writeTree = async ({ dir, files }: { dir: string; files: Record<string, string> }) => {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content, 'utf8');
	}
};

/** The smallest tree `readStandardsPack` accepts: a root file, one document, one judgment-only rule under it. */
const packFiles = ({ root }: { root: Record<string, unknown> }) => ({
	'lightsout-standards.json': JSON.stringify(root),
	'code/house/document.md': '# House Style\n\nWhat this shop agrees on.\n',
	'code/house/05-house-loose-file/rule.md': '---\nsummary: a source file outside a module\n---\n\nEvery file belongs to a module.\n',
});

/**
 * The environment variable naming the default pack, as this suite's setups
 * choose it.
 *
 * Every suite in this repo runs with it pointed at the authored pack (see
 * tooling/jest/setupTestEnvironment.ts). The whole `process.env` object is
 * replaced rather than the one key, because assigning `undefined` to a key of
 * `process.env` stores the string "undefined" — and `restoreMocks` puts the real
 * object back before the next test.
 */
const setDefaultPackVariable = ({ packPath }: { packPath?: string }) => {
	const env = { ...process.env };

	if (packPath === undefined) {
		delete env.LIGHTSOUT_DEFAULT_STANDARDS;
	} else {
		env.LIGHTSOUT_DEFAULT_STANDARDS = packPath;
	}

	jest.replaceProperty(process, 'env', env);
};

/** A repo of somebody's own, with the packs its config names written beside it. */
const setupConfiguredRepo = async ({ packs }: { packs: { folder: string; name: string }[] }) => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-list-'));
	const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

	await writeTree({
		dir: cwd,
		files: {
			'lightsout.config.json': JSON.stringify({
				gates: { check: 'true', test: 'true', 'test-coverage': false },
				'standards-packs': packs.map((pack) => `./${pack.folder}`),
			}),
		},
	});

	for (const pack of packs) {
		await writeTree({ dir: join(cwd, pack.folder), files: packFiles({ root: { name: pack.name, formatVersion: 1 } }) });
	}

	return { cwd, warn };
};

/** A repo that is itself a pack: the root file sits beside the repo's own folders, and no config names anything. */
const setupRepoThatIsAPack = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-selfpack-'));

	await writeTree({ dir: cwd, files: packFiles({ root: { name: 'acme', formatVersion: 1 } }) });
	setDefaultPackVariable({ packPath: undefined });

	return { cwd };
};

/** A plain repo with no config and no pack beside it, pointed at a default pack that lives somewhere else entirely. */
const setupRepoOnADefaultPackElsewhere = async ({ root }: { root: Record<string, unknown> }) => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-plain-'));
	const packPath = await mkdtemp(join(tmpdir(), 'lightsout-packs-default-'));

	await writeTree({ dir: packPath, files: packFiles({ root }) });
	setDefaultPackVariable({ packPath });

	return { cwd, packPath };
};

/** A repo with nothing to load: no config, no pack beside it, and a default pack named at a folder that is not one. */
const setupRepoWithNoPackAnywhere = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-nowhere-'));
	const notAPack = await mkdtemp(join(tmpdir(), 'lightsout-packs-notapack-'));
	const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

	setDefaultPackVariable({ packPath: notAPack });

	return { cwd, warn };
};

/** A repo whose config is there and will not parse — a typo, not an absence. */
const setupRepoWithABrokenConfig = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-badconfig-'));
	const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

	await writeTree({ dir: cwd, files: { 'lightsout.config.json': '{ "gates": ' } });

	return { cwd, warn };
};

/** The same repo, already listed once, with a second rule written into its pack afterwards. */
const setupRepoWithARuleAddedAfterAFirstRead = async () => {
	const { cwd, packPath } = await setupRepoOnADefaultPackElsewhere({ root: { name: 'acme', formatVersion: 1 } });
	const listed = await listStandardsPacks({ cwd });

	await writeTree({ dir: packPath, files: { 'code/house/10-house-name-things-well/rule.md': '---\nsummary: a name that hides what it does\n---\n' } });

	return { cwd, before: listed[0]?.totals.rules };
};

describe('listStandardsPacks', () => {
	test('says where a standards-packs entry would point for a pack that is the repo itself', async () => {
		const { cwd } = await setupRepoThatIsAPack();

		const packs = await listStandardsPacks({ cwd });

		// the pack root and the repo root are one folder, so the entry a reader
		// would copy is the repo itself rather than an empty string
		expect(packs.map((pack) => ({ name: pack.name, path: pack.path, isDefault: pack.isDefault }))).toStrictEqual([
			{ name: 'acme', path: '.', isDefault: true },
		]);
	});

	test('gives the whole path for a pack that sits outside the repo, where a relative one would point at nothing', async () => {
		const { cwd, packPath } = await setupRepoOnADefaultPackElsewhere({ root: { name: 'acme', formatVersion: 1 } });

		const packs = await listStandardsPacks({ cwd });

		expect(packs[0]?.path).toBe(packPath);
	});

	test('says a built pack was shipped without its fixtures, so a page can explain a count of zero', async () => {
		const { cwd } = await setupRepoOnADefaultPackElsewhere({
			root: { name: 'acme', formatVersion: 1, built: true, homepage: 'https://example.com/acme' },
		});

		const packs = await listStandardsPacks({ cwd });

		expect(packs[0]).toEqual(
			expect.objectContaining({
				built: true,
				homepage: 'https://example.com/acme',
				totals: { rules: 1, checked: 0, judgment: 1, documents: 1, withFixtures: 0 },
			}),
		);
	});

	test('leaves description and homepage off a pack that declares neither, rather than carrying empty ones', async () => {
		const { cwd } = await setupRepoOnADefaultPackElsewhere({ root: { name: 'acme', formatVersion: 1 } });

		const packs = await listStandardsPacks({ cwd });

		// both are optional on the contract, so a card shows only what the pack said —
		// and no rule or document rides along on a listing row
		expect(Object.keys(packs[0] ?? {}).sort()).toStrictEqual(['built', 'channels', 'isDefault', 'name', 'path', 'rootPath', 'totals']);
	});

	test('leaves out the second pack claiming a name the first already took, since the name is what a URL addresses', async () => {
		const { cwd, warn } = await setupConfiguredRepo({
			packs: [
				{ folder: 'house', name: 'acme' },
				{ folder: 'legacy', name: 'acme' },
			],
		});

		const packs = await listStandardsPacks({ cwd });

		expect(packs.map((pack) => pack.path)).toStrictEqual(['house']);
		// the collision is loud where the person who can fix it reads, not arbitrary in the page
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('acme'));
	});

	test('lists both packs a repo stacks, in the order its config names them', async () => {
		const { cwd } = await setupConfiguredRepo({
			packs: [
				{ folder: 'house', name: 'acme' },
				{ folder: 'extra', name: 'acme-react' },
			],
		});

		const packs = await listStandardsPacks({ cwd });

		expect(packs.map((pack) => pack.name)).toStrictEqual(['acme', 'acme-react']);
	});

	test('answers with nothing when no pack can be found from here, rather than failing the page', async () => {
		const { cwd, warn } = await setupRepoWithNoPackAnywhere();

		const packs = await listStandardsPacks({ cwd });

		// the page says it found nothing; why is in the server log, where the
		// person who can fix it is reading
		expect(packs).toStrictEqual([]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(cwd));
	});

	test('answers with nothing when the repo has a config that will not parse, rather than falling back to the default pack', async () => {
		const { cwd, warn } = await setupRepoWithABrokenConfig();

		const packs = await listStandardsPacks({ cwd });

		// a broken config is a different fact from no config, and quietly loading
		// the default pack would hide it
		expect(packs).toStrictEqual([]);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(cwd));
	});

	test('sees a pack edited on disk on the next read, so a viewer used while writing rules needs no restart', async () => {
		const { cwd, before } = await setupRepoWithARuleAddedAfterAFirstRead();

		const after = await listStandardsPacks({ cwd });

		// the first read is cached against the folder's newest modification time,
		// so this is the cache noticing the new rule rather than never having read
		expect([before, after[0]?.totals.rules]).toStrictEqual([1, 2]);
	});
});
