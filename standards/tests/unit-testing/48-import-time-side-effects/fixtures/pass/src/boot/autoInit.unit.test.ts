import { expect, describe, test, jest } from '@jest/globals';

const setupBoot = ({ hasScript = true }: { hasScript?: boolean } = {}) => {
	jest.replaceProperty(document, 'currentScript', hasScript ? document.createElement('script') : null);

	return { hasScript };
};

describe('autoInit', () => {
	test('reads the current script the module was loaded from', () => {
		setupBoot({ hasScript: true });

		let loaded: { isInitialized: boolean } | undefined;
		jest.isolateModules(() => {
			loaded = require('./autoInit') as { isInitialized: boolean };
		});

		expect(loaded?.isInitialized).toBe(true);
	});
});
