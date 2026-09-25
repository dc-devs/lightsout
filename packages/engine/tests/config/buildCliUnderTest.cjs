const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const checkSparkplugOff = require('../../../../tooling/jest/checkSparkplugOff.cjs');

const repoRoot = join(__dirname, '..', '..', '..', '..');

// Builds the CLI the e2e suite runs, from current source. scripts/buildEngine.mjs
// owns the build options; `out` keeps it off the committed plugin/dist/cli.mjs.
// Naming a globalSetup replaces createJestConfig's, so its check is called here.
module.exports = async () => {
	await checkSparkplugOff();

	const { buildEngine } = await import(pathToFileURL(join(repoRoot, 'scripts', 'buildEngine.mjs')).href);

	await buildEngine({ out: join(repoRoot, '.test-dist', 'cli-under-test.mjs') });
};
