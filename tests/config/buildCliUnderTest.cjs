const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const repoRoot = join(__dirname, '..', '..');

// tests/cli.test.ts runs .test-dist/cli-under-test.mjs as a real subprocess and
// pins its exact stdout/stderr/exit codes. Hanging the build off the e2e config
// rather than off the npm script means running jest directly still tests current
// source instead of a stale bundle — and keeps the cost off the unit suite.
// Flags are copied from the `bundle` script, retargeted to .test-dist/.
module.exports = async () => {
	execFileSync(
		join(repoRoot, 'node_modules', '.bin', 'esbuild'),
		[
			'src/cli/index.ts',
			'--bundle',
			'--platform=node',
			'--format=esm',
			'--loader:.md=text',
			"--banner:js=import { createRequire as __cjsRequire } from 'node:module'; const require = __cjsRequire(import.meta.url);",
			'--outfile=.test-dist/cli-under-test.mjs',
			'--log-level=warning',
		],
		{ cwd: repoRoot, stdio: 'inherit' },
	);
};
