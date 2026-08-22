import { describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CopyButton } from '#src/appUI/CopyButton.tsx';

const setupCopyButton = ({ refused = false }: { refused?: boolean } = {}) => {
	jest.useFakeTimers();

	const mockWriteText = jest.fn<(text: string) => Promise<void>>();

	if (refused) {
		mockWriteText.mockRejectedValue(new Error('clipboard blocked on an insecure origin'));
	} else {
		mockWriteText.mockResolvedValue();
	}

	// jsdom implements the DOM, not the platform around it: navigator has no
	// clipboard at all, so the property is defined rather than spied on.
	Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, configurable: true });
	render(<CopyButton value="lightsout resume --run abcdef01" label="Copy resume command" />);

	return { button: screen.getByRole('button'), mockWriteText };
};

describe('CopyButton', () => {
	test('says what it will copy before it is pressed', () => {
		const { button } = setupCopyButton();

		expect(button).toHaveTextContent('Copy resume command');
	});

	test('hands the clipboard exactly the string it was given', async () => {
		const { button, mockWriteText } = setupCopyButton();

		await act(async () => {
			fireEvent.click(button);
		});

		expect(mockWriteText).toHaveBeenCalledWith('lightsout resume --run abcdef01');
	});

	test('confirms the copy happened', async () => {
		const { button } = setupCopyButton();

		await act(async () => {
			fireEvent.click(button);
		});

		expect(button).toHaveTextContent('Copied');
	});

	test('goes back to offering the copy once the moment has passed', async () => {
		const { button } = setupCopyButton();

		await act(async () => {
			fireEvent.click(button);
		});
		await act(async () => {
			jest.advanceTimersByTime(2_000);
		});

		expect(button).toHaveTextContent('Copy resume command');
	});

	test('claims nothing when the browser refuses the clipboard', async () => {
		const { button } = setupCopyButton({ refused: true });

		await act(async () => {
			fireEvent.click(button);
		});

		expect(button).toHaveTextContent('Copy resume command');
	});
});
