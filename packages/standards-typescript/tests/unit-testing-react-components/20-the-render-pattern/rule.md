---
summary: "a component test that renders outside the setup factory or destructures queries from render()"
checked: false
severity: advisory
---

## The Render Pattern

Render inside the `setup()` factory; query and assert in the `test`. For a component, `render()` *is* the act, but by convention it lives in the arrange factory — the one accepted exception to "the act lives in the `test`". Query from `screen` — never destructure queries from `render()`.

```typescript
import { expect, describe, test, jest } from '@jest/globals';
import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { NotificationBanner } from './NotificationBanner';

// Mocked Imports
// -------------------------
const mockUseAppStore = jest.fn<(selector: (state: unknown) => unknown) => unknown>();

jest.mock('@store/appStore', () => ({
	useAppStore: (selector: (state: unknown) => unknown) => mockUseAppStore(selector),
}));
// -------------------------

const setupNotificationBanner = ({ isVisible = true }: { isVisible?: boolean } = {}) => {
	const onDismiss = jest.fn<() => void>();
	mockUseAppStore.mockReturnValue(isVisible);
	render(<NotificationBanner onDismiss={onDismiss} />);

	return { onDismiss };
};

describe('NotificationBanner', () => {
	test('does not render the banner when not visible', () => {
		setupNotificationBanner({ isVisible: false });

		const banner = screen.queryByRole('alert');

		expect(banner).not.toBeInTheDocument();
	});

	test('renders the notification message when visible', () => {
		setupNotificationBanner({ isVisible: true });

		const message = screen.getByText('Action required');

		expect(message).toBeInTheDocument();
	});

	test('calls the dismiss handler when the dismiss button is clicked', async () => {
		const { onDismiss } = setupNotificationBanner({ isVisible: true });
		const user = userEvent.setup();

		const dismissButton = screen.getByRole('button', { name: /dismiss/i });
		await user.click(dismissButton);

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
```
