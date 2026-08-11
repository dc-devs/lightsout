import { expect, describe, test } from '@jest/globals';
import { render } from '@testing-library/react';
import { NotificationBanner } from './NotificationBanner';

describe('NotificationBanner', () => {
	test('renders the notification message when visible', () => {
		// render in the test body, and queries destructured from its result
		const { getByText } = render(<NotificationBanner isVisible message="Action required" />);

		expect(getByText('Action required')).toBeInTheDocument();
	});
});
