import { defaultTimeout } from '../constants/defaultTimeout';

export const getTimeout = (raw?: string): number => (raw === undefined ? defaultTimeout : Number(raw));
