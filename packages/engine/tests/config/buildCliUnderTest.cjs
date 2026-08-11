const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = join(__dirname, '..', '..', '..', '..');

// tests/cli.test.ts runs .test-dist/cli-under-test.mjs as a real subprocess and
// pins its exact stdout/stderr/exit codes. Hanging the build off the e2e config
// rather than off the npm script means running jest directly still tests current
// source instead of a stale bundle — and keeps the cost off the unit suite.
//
// The esbuild options are not repeated here. scripts/buildEngine.mjs owns them,
// and `out` is how this suite gets its own copy without writing over the
// committed plugin/dist/cli.mjs that scripts/checkShipped.mjs measures against.
// Spelled out a second time, this would build something subtly different from
// what ships and the e2e suite would be pinning the wrong program.
//
// Imported rather than required: buildEngine.mjs is ESM with a top-level await,
// which `require` refuses. A globalSetup may be async, so dynamic import costs
// nothing and avoids paying for a subprocess.
module.exports = async () => {
	const { buildEngine } = await import(pathToFileURL(join(repoRoot, 'scripts', 'buildEngine.mjs')).href);

	await buildEngine({ out: join(repoRoot, '.test-dist', 'cli-under-test.mjs') });
};
