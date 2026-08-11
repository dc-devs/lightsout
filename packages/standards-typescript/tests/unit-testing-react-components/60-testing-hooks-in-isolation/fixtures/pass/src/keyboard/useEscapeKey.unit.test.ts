import { expect, describe, test, jest } from '@jest/globals';
import { useEscapeKey } from './index';

// Mocked Imports
// -------------------------
let mockEffectCallback: (() => undefined | (() => void)) | undefined;

jest.mock('react', () => ({
	useEffect: (callback: () => undefined | (() => void)) => {
		mockEffectCallback = callback;
	},
}));
// -------------------------

const setupEscapeKey = ({ isActive = true }: { isActive?: boolean } = {}) => {
	mockEffectCallback = undefined;
	const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
	const onEscape = jest.fn<() => void>();
	useEscapeKey({ isActive, onEscape });

	return { addEventListenerSpy, onEscape };
};

describe('useEscapeKey', () => {
	test('adds a keydown event listener', () => {
		const { addEventListenerSpy } = setupEscapeKey({ isActive: true });

		mockEffectCallback?.();

		expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
	});
});
