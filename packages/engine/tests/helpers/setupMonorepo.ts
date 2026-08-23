import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { strictProfile } from '#tests/helpers/strictProfile.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

interface Params {
	plan?: string;
}

/**
 * A minimal monorepo consumer in a temp dir: packages/api and packages/web
 * whose package.json names (@acme/*) deliberately differ from their
 * directory names, gate commands that log "<group> <kind>" to gates.log,
 * a git history, and the strict profile (`strictProfile`) so planted layout
 * defects are work rather than advice.
 */
export const setupMonorepo = ({ plan = '---\npackages:\n  - api\n---\n# Plan: api feature\n' }: Params = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-mono-test-'));

	for (const [pkgDir, pkgName] of [
		['api', '@acme/api'],
		['web', '@acme/web'],
	] as const) {
		mkdirSync(join(dir, 'packages', pkgDir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'packages', pkgDir, 'package.json'), JSON.stringify({ name: pkgName }));
		// each package is its own program: an entry that consumes the module beside it
		writeSource({ dir, path: `packages/${pkgDir}/src/index.js`, source: 'export const one = 1;\n' });
	}

	writeFileSync(join(dir, 'plan.md'), plan);
	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			gates: {
				check: `${gateLogCommand({ kind: 'check' })} root`,
				test: `${gateLogCommand({ kind: 'test' })} root`,
				'test-coverage': `${gateLogCommand({ kind: 'coverage' })} root`,
			},
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package}`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
				'test-coverage': `${gateLogCommand({ kind: 'coverage' })} {package}`,
			},
			'standards-checks': strictProfile,
		}),
	);
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });

	return dir;
};
