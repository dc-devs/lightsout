import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateLogCommand } from '@tests/helpers/gateLogCommand';

interface Params {
	plan?: string;
}

/**
 * A minimal monorepo consumer in a temp dir: packages/api and packages/web
 * whose package.json names (@acme/*) deliberately differ from their
 * directory names, gate commands that log "<group> <kind>" to gates.log,
 * and a git history.
 */
export const setupMonorepo = ({ plan = '---\npackages:\n  - api\n---\n# Plan: api feature\n' }: Params = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-mono-test-'));

	for (const [pkgDir, pkgName] of [
		['api', '@acme/api'],
		['web', '@acme/web'],
	] as const) {
		mkdirSync(join(dir, 'packages', pkgDir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'packages', pkgDir, 'package.json'), JSON.stringify({ name: pkgName }));
		writeFileSync(join(dir, 'packages', pkgDir, 'src/index.js'), 'export const one = 1;\n');
	}

	writeFileSync(join(dir, 'plan.md'), plan);
	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			scripts: {
				check: `${gateLogCommand({ kind: 'check' })} root`,
				testUnit: `${gateLogCommand({ kind: 'testUnit' })} root`,
				testCoverage: `${gateLogCommand({ kind: 'coverage' })} root`,
			},
			packageScripts: {
				check: `${gateLogCommand({ kind: 'check' })} {package}`,
				testUnit: `${gateLogCommand({ kind: 'testUnit' })} {package}`,
				testCoverage: `${gateLogCommand({ kind: 'coverage' })} {package}`,
			},
		}),
	);
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });

	return dir;
};
