import { expect, describe, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { NotificationBanner } from './NotificationBanner';

const setupNotificationBanner = () => {
	render(<NotificationBanner message="Action required" />);
};

describe('NotificationBanner', () => {
	test('renders the notification message', () => {
		setupNotificationBanner();

		const message = screen.getByText('Action required');

		expect(message).toBeInTheDocument();
	});
});
