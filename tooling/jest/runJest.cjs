// Test scripts run this as `node --no-sparkplug runJest.cjs`: the flag avoids a
// V8 crash that kills Jest workers (https://github.com/nodejs/node/issues/62393).
// NODE_OPTIONS refuses the flag and `.bin/jest` cannot pass it, so it goes on
// `node` itself; the workers inherit it. Remove it once a Node release stops
// crashing without it.
require('jest/bin/jest');
