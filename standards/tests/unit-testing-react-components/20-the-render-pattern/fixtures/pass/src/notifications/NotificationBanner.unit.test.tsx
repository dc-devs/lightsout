import { expect, describe, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { NotificationBanner } from './NotificationBanner';

const setupNotificationBanner = ({ isVisible = true }: { isVisible?: boolean } = {}) => {
	render(<NotificationBanner isVisible={isVisible} message="Action required" />);
};

describe('NotificationBanner', () => {
	test('renders the notification message when visible', () => {
		setupNotificationBanner({ isVisible: true });

		const message = screen.getByText('Action required');

		expect(message).toBeInTheDocument();
	});
});
