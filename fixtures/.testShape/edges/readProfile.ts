import { jest } from '@jest/globals';

const getProfile = jest.fn<() => string>();

export const readProfile = (): string => getProfile();
