import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSource } from '#tests/helpers/writeSource.ts';

interface Params {
	git?: boolean;
	plan?: string;
	/** Merged over the default gate commands (check/test 'true', testCoverage false). */
	scripts?: Record<string, string | false>;
	/** Extra top-level config fields (standards, package-gates, ...). */
	config?: Record<string, unknown>;
	/**
	 * Source files to plant, by repo-relative path, replacing the one the repo
	 * carries by default. Plant a file here rather than writing it after the
	 * call: these are wired into the entry point, and a file written afterwards
	 * is one nothing imports — which the standards checks report as findings the
	 * test never planted. `writeSource` is how to add one mid-test.
	 */
	sources?: Record<string, string>;
}

/**
 * The rules that ask "does anything consume this?", switched off.
 *
 * For a fixture whose subject IS an unconsumed, hidden or barrel-only export —
 * writer selection, import topology, unreachable-file handling — leaving these
 * on reports the fixture's own premise as work to delete, and the run never
 * reaches the question the test asks. Ordinary fixtures wire their modules into
 * a consumer with `writeSource` instead of switching anything off.
 */
export const reachabilityRulesOff = {
	'standards-checks': { 'dead-export': 'off', 'barrel-only-export': 'off', 'test-only-export': 'off' },
};

/** The one source file a repo carries when a test plants none of its own. */
const defaultSources = { 'src/index.js': 'export const one = 1;\n' };

/**
 * A minimal consumer repo in a temp dir: an entry point, the sources it
 * consumes, a plan, a config, and (by default) a git history so changed-file
 * truth is exercisable.
 *
 * The repo is a whole program rather than a pile of files, because the real
 * standards checks run against it and several of them ask what consumes an
 * export. Something has to be the end of that chain, which is why the entry
 * point exports nothing itself.
 */
export const setupConsumerRepo = ({ git = true, plan = '# Plan: add feature\n', scripts, config, sources }: Params = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-test-'));

	for (const [path, source] of Object.entries(sources ?? defaultSources)) {
		writeSource({ dir, path, source });
	}

	writeFileSync(join(dir, 'plan.md'), plan);
	writeFileSync(join(dir, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false, ...scripts }, ...config }));

	if (git) {
		execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });
	}

	return dir;
};
