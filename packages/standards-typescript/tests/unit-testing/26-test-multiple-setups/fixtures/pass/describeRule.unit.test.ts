import { expect, describe, test } from '@jest/globals';
import { describeRule } from './describeRule';

const setupRule = ({ id = 'test-shared-let' }: { id?: string } = {}) => {
	return { id };
};

// A rule about arrangement has to quote `setup()` in the guidance it renders,
// and the expected text is not a second call — it is what the assertion pins.
describe('describeRule', () => {
	test('renders the guidance the rule ships', () => {
		const { id } = setupRule();

		const described = describeRule({ id });

		expect(described.guidance).toBe('Arrange in a `setup()` factory that returns its locals as consts.');
	});
});
