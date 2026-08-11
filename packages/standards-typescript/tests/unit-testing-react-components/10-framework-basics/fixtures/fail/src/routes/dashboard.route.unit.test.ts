import { expect, describe, test } from '@jest/globals';
import { DashboardRoute } from './dashboard.route';

// A route file is thin wiring covered by e2e tests and the screen component's
// own tests, and a component test cannot live in a .ts file at all.
describe('DashboardRoute', () => {
	test('is defined', () => {
		expect(DashboardRoute).toBeDefined();
	});
});
