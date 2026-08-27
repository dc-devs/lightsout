import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { toRepoRelativePath } from '#src/common/utils/toRepoRelativePath.ts';
import { FixtureSide, type StandardsPackBundle, type StandardsPackRuleView } from '#src/contracts/index.ts';
import { type LoadedStandardsRule, readStandardsPack } from '#src/standardsPacks/index.ts';
import { readPackFixtures } from '#src/views/common/utils/readPackFixtures.ts';
import { toStandardsPackRuleListing } from '#src/views/common/utils/toStandardsPackRuleListing.ts';

/** The newest modification time anywhere under a folder — the stamp that says whether a cached read is still current. */
const getNewestMtime = async ({ root }: { root: string }) => {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	let newest = 0;

	for (const entry of entries) {
		const path = join(root, entry.name);
		const at = entry.isDirectory()
			? await getNewestMtime({ root: path })
			: await stat(path).then(
					(stats) => stats.mtimeMs,
					() => 0,
				);

		newest = Math.max(newest, at);
	}

	return newest;
};

/**
 * What a `standards-packs` entry would say for this pack: repo-relative, or
 * absolute when the pack sits outside the repo.
 *
 * Named apart from `toRepoRelativePath`, which it builds on, because it answers
 * a different question: that one always produces a route relative to the repo,
 * including a `../` walk outward, while a config entry naming a pack outside the
 * repo is written out in full.
 */
const toPackEntryPath = ({ rootPath, cwd }: { rootPath: string; cwd: string }) => {
	const relativePath = toRepoRelativePath({ cwd, path: rootPath });
	// `..` is matched as a whole segment and the result is checked for being
	// absolute: a folder legitimately named `..packs` would begin with those two
	// characters without being outside anything, and a Windows path on another
	// drive comes back absolute rather than as a walk upward.
	const isOutside = relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
	let path = relativePath;

	if (isOutside) {
		path = rootPath;
	} else if (relativePath === '') {
		path = '.';
	}

	return path;
};

/** One rule folded into the bundle's shape: what it is, what it argues, and the files that prove it. */
const toRuleView = async ({ rule }: { rule: LoadedStandardsRule }) => {
	// `run` and `inputKind` are deliberately dropped: a function cannot cross the
	// wire, and no page shows a check's source code.
	const fixtures = await readPackFixtures({ fixturesPath: rule.fixturesPath });
	const fixtureCounts = {
		pass: fixtures.filter((fixture) => fixture.side === FixtureSide.Pass).length,
		fail: fixtures.filter((fixture) => fixture.side === FixtureSide.Fail).length,
	};

	return { ...toStandardsPackRuleListing({ rule, fixtureCounts }), prose: rule.prose, fixtures };
};

/** The pack read off disk and folded whole, so nothing downstream ever holds a `LoadedStandardsPack`. */
const readBundle = async ({ packPath, isDefault, cwd }: { packPath: string; isDefault: boolean; cwd: string }) => {
	const pack = await readStandardsPack({ packPath });
	const rules: StandardsPackRuleView[] = [];

	for (const rule of pack.rules) {
		rules.push(await toRuleView({ rule }));
	}

	return {
		name: pack.name,
		...(pack.description === undefined ? {} : { description: pack.description }),
		...(pack.homepage === undefined ? {} : { homepage: pack.homepage }),
		isDefault,
		rootPath: pack.rootPath,
		path: toPackEntryPath({ rootPath: pack.rootPath, cwd }),
		built: pack.built === true,
		channels: [...new Set(pack.documents.map((document) => document.channel))].sort(),
		totals: {
			rules: rules.length,
			checked: rules.filter((rule) => rule.checked).length,
			judgment: rules.filter((rule) => !rule.checked).length,
			documents: pack.documents.length,
			withFixtures: rules.filter((rule) => rule.fixtureCounts.pass > 0 && rule.fixtureCounts.fail > 0).length,
		},
		documents: pack.documents.map((document) => ({
			set: document.set,
			path: document.path,
			channel: document.channel,
			intro: document.intro,
			ruleIds: document.ruleIds,
		})),
		rules,
	};
};

/**
 * The pack reads this process has already done, kept until the folder they came
 * from changes.
 *
 * Reading a pack is megabytes of fixture text plus a folder parse per rule, and
 * one pack page's first paint asks for it seven times — the view, then the six
 * showcase rules the loader warms — each as a separate server-function call. A
 * memo inside any one of those calls would save nothing, so this is an instance
 * that outlives them, which is what `common/services/` is for.
 *
 * What is stored is the in-flight promise rather than the resolved value, so
 * those seven callers share one read; a rejected one drops its entry, so a
 * failure is never cached. Against each entry sits the newest modification time
 * under the pack root, so editing a rule or a fixture is seen on the next
 * request instead of after a restart — which is what a viewer used while writing
 * rules needs.
 */
export class StandardsPackBundleCache {
	private readonly inFlight = new Map<string, { stamp: number; bundle: Promise<StandardsPackBundle> }>();

	/**
	 * One pack whole, read from disk or from this cache.
	 *
	 * Keyed by the pack root AND the repo it is being read for, because `path`
	 * and `isDefault` are answers about that repo and the cached bundle has to be
	 * whole — nothing above this stamps a field onto a copy. There is one repo per
	 * running viewer, so the second key costs nothing in practice.
	 */
	async read({ packPath, isDefault, cwd }: { packPath: string; isDefault: boolean; cwd: string }): Promise<StandardsPackBundle> {
		// A NUL joins them because it is the one byte a path cannot hold, so no pair
		// of (pack root, repo) can ever spell another pair's key.
		const key = `${packPath}\u0000${cwd}`;
		const stamp = await getNewestMtime({ root: packPath });
		const cached = this.inFlight.get(key);
		let bundle = cached?.bundle;

		if (bundle === undefined || cached?.stamp !== stamp) {
			bundle = readBundle({ packPath, isDefault, cwd });
			this.inFlight.set(key, { stamp, bundle });

			const pending = bundle;

			void pending.catch(() => {
				if (this.inFlight.get(key)?.bundle === pending) {
					this.inFlight.delete(key);
				}
			});
		}

		return bundle;
	}
}
