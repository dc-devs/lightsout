import { expect, describe, test, jest } from '@jest/globals';
import { useEscapeKey } from './index';

// Every hook primitive stubbed, including the three this hook never calls —
// each one a shim that can drift from the framework for no coverage in return.
jest.mock('react', () => ({
	useEffect: (callback: () => void) => callback(),
	useCallback: <T>(callback: T) => callback,
	useMemo: (factory: () => unknown) => factory(),
	useState: (initial: unknown) => [initial, () => undefined],
	useRef: (initial: unknown) => ({ current: initial }),
	useContext: () => ({}),
}));

describe('useEscapeKey', () => {
	test('adds a keydown event listener', () => {
		const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

		useEscapeKey({ isActive: true, onEscape: jest.fn<() => void>() });

		expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
	});
});
