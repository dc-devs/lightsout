import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Params {
	git?: boolean;
	plan?: string;
	/** Merged over the default gate commands (check/test 'true', testCoverage false). */
	scripts?: Record<string, string | false>;
	/** Extra top-level config fields (standards, packageGates, ...). */
	config?: Record<string, unknown>;
}

/**
 * A minimal consumer repo in a temp dir: one source file, a plan, a config,
 * and (by default) a git history so changed-file truth is exercisable.
 */
export const setupConsumerRepo = ({ git = true, plan = '# Plan: add feature\n', scripts, config }: Params = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-test-'));

	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'src/index.js'), 'export const one = 1;\n');
	writeFileSync(join(dir, 'plan.md'), plan);
	writeFileSync(join(dir, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', testCoverage: false, ...scripts }, ...config }));

	if (git) {
		execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });
	}

	return dir;
};
