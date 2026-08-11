import { expect, describe, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { DismissButton } from './DismissButton';

const setupDismissButton = () => {
	render(<DismissButton />);
};

describe('DismissButton', () => {
	test('renders a button users and assistive technology can find', () => {
		setupDismissButton();

		const button = screen.getByRole('button', { name: /dismiss/i });

		expect(button).toBeInTheDocument();
	});
});
