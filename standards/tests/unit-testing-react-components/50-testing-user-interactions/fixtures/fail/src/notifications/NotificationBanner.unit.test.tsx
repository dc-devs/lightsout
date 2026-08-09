import { expect, describe, test, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBanner } from './NotificationBanner';

const setupNotificationBanner = () => {
	const onDismiss = jest.fn<() => void>();
	render(<NotificationBanner onDismiss={onDismiss} />);

	return { onDismiss };
};

describe('NotificationBanner', () => {
	test('calls the dismiss handler when the dismiss button is clicked', async () => {
		const { onDismiss } = setupNotificationBanner();
		// the target query grouped with arrange, and the interaction left unawaited
		const dismissButton = screen.getByRole('button', { name: /dismiss/i });
		const user = userEvent.setup();

		user.click(dismissButton);

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
