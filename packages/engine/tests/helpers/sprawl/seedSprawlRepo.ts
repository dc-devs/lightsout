import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..');

/** The one engine module the sprawl scripts import; the fixture needs it at the same repo-relative path. */
const enginePredicate = join('packages', 'engine', 'src', 'common', 'sourceFiles', 'isTestFile.ts');

/** A rule file's front matter, with prose under it so the settings reader has somewhere to stop. */
const frontMatter = ({ settings }: { settings: string[] }) => ['---', 'summary: "a rule"', 'settings:', ...settings, '---', '', 'prose below', ''].join('\n');

/**
 * The four rule files `readSprawlCaps.mjs` reads. The numbers are the
 * fixture's, deliberately not the pack's: a test that read the shipped rule
 * would go red the day someone tuned a cap.
 */
const defaultRules: Record<string, string> = {
	'code/style-guide/patterns/functions/30-size-file/rule.md': frontMatter({ settings: ['  file: 100', '  tsxFile: 120'] }),
	'code/style-guide/patterns/functions/25-size-function/rule.md': frontMatter({ settings: ['  function: 30'] }),
	'tests/unit-testing/18-test-size-file/rule.md': frontMatter({ settings: ['  testFile: 400'] }),
	'code/architecture/folder-structure/35-crowded-folder/rule.md': frontMatter({ settings: ['  cap: 3'] }),
};

interface Params {
	/** One commit per entry, oldest first, each stamped with the given author and committer date. */
	commits?: { message: string; at: string; write?: Record<string, string>; remove?: string[] }[];
	/** Rule-relative path to file body, merged over the defaults above; an explicit `undefined` leaves that rule file off disk. */
	rules?: Record<string, string | undefined>;
	/** `.lightsout/runs/<key>/manifest.json` bodies, written as raw text so a malformed manifest can be seeded. */
	runs?: Record<string, string>;
}

/**
 * A throwaway git repository shaped the way the sprawl scripts read one: a
 * history under `packages/`, the standards pack's cap rule files, an `assets/`
 * folder for the dataset, and this working tree's `scripts/` copied in so the
 * scripts run against the fixture rather than against this repo — plus the one
 * engine module those scripts import, at the path they import it by.
 *
 * Everything but the commits is written afterwards and left untracked, so the
 * rule files, the run markers and the output folder never appear in a git tree
 * the scripts measure.
 *
 * @returns the repository root; the caller removes its parent when done
 */
export const seedSprawlRepo = ({ commits = [], rules, runs }: Params = {}): string => {
	const cwd = join(mkdtempSync(join(tmpdir(), 'lightsout-sprawl-')), 'repo');
	const git = ({ args, at }: { args: string[]; at?: string }) =>
		execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } });

	mkdirSync(cwd, { recursive: true });
	git({ args: ['init', '-q', '-b', 'main'] });

	for (const commit of commits) {
		for (const [path, contents] of Object.entries(commit.write ?? {})) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true });
			writeFileSync(join(cwd, path), contents);
		}

		for (const path of commit.remove ?? []) {
			rmSync(join(cwd, path), { force: true, recursive: true });
		}

		git({ args: ['add', '-A'] });
		git({ args: ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', commit.message], at: commit.at });
	}

	cpSync(join(repoRoot, 'scripts'), join(cwd, 'scripts'), { recursive: true });
	// `readSprawlTrees.mjs` asks the engine what counts as a test rather than
	// carrying its own copy of the answer, and it reaches for it by a path
	// relative to itself — which, once the scripts are copied in here, is this
	// fixture. Untracked like the rule files below, so no git tree the scripts
	// measure ever sees it.
	mkdirSync(join(cwd, 'packages', 'engine', 'src', 'common', 'sourceFiles'), { recursive: true });
	cpSync(join(repoRoot, enginePredicate), join(cwd, enginePredicate));
	mkdirSync(join(cwd, 'assets'), { recursive: true });

	const ruleFiles: Record<string, string | undefined> = { ...defaultRules, ...rules };

	for (const [rule, body] of Object.entries(ruleFiles)) {
		if (body === undefined) {
			continue;
		}

		mkdirSync(dirname(join(cwd, 'packages', 'standards-typescript', rule)), { recursive: true });
		writeFileSync(join(cwd, 'packages', 'standards-typescript', rule), body);
	}

	for (const [id, manifest] of Object.entries(runs ?? {})) {
		mkdirSync(join(cwd, '.lightsout', 'runs', id), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', id, 'manifest.json'), manifest);
	}

	return cwd;
};
