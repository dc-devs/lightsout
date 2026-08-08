import { expect, describe, test, jest, beforeEach } from '@jest/globals';

const mockRenderTemplate = jest.fn<() => string>();

describe('bracesInStrings', () => {
	beforeEach(() => {
		const template = '{ "closed": true }';
		// a lone } in a comment, and a { to keep it company

		mockRenderTemplate.mockReturnValue(template);
	});

	test('renders the template', () => {
		expect(mockRenderTemplate()).toBe('{ "closed": true }');
	});
});
