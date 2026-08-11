---
summary: "an interaction test that groups the target query with arrange instead of the act"
checked: false
severity: advisory
---

## Testing User Interactions

`userEvent` is async — create the user in the test and `await` the interaction. The query that locates the interaction target groups with the act (the `userEvent` call), not with arrange:

```typescript
test('calls the dismiss handler when the dismiss button is clicked', async () => {
	const { onDismiss } = setupBanner();
	const user = userEvent.setup();

	const dismissButton = screen.getByRole('button', { name: /dismiss/i });
	await user.click(dismissButton);

	expect(onDismiss).toHaveBeenCalledTimes(1);
});
```

When the package lacks `@testing-library/user-event`, use `fireEvent` instead — synchronous, no setup object: `fireEvent.click(dismissButton);`. The same grouping rule applies: the target query groups with the act.
