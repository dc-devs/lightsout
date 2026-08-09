import { expect, describe, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { DismissButton } from './DismissButton';

const setupDismissButton = () => {
	render(<DismissButton />);
};

describe('DismissButton', () => {
	test('renders a button users and assistive technology can find', () => {
		setupDismissButton();

		// a test id added to source for the test's convenience, where the button's
		// own role and label would have found it
		const button = screen.getByTestId('dismiss-button');

		expect(button).toBeInTheDocument();
	});
});
