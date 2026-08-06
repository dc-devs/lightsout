const { createHash } = require('node:crypto');

// The runtime half of src/markdown.d.ts. The engine imports its prompts and
// standards docs as strings, which worked only because esbuild was handed
// --loader:.md=text; under Jest this transform supplies the same thing. The
// emitted module is ES-module-shaped so the default import resolves whether or
// not esModuleInterop is in play.
module.exports = {
	process(sourceText) {
		return { code: `module.exports = { __esModule: true, default: ${JSON.stringify(sourceText)} };\n` };
	},
	getCacheKey(sourceText) {
		return createHash('sha256').update(sourceText).digest('hex');
	},
};
