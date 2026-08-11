import { defaultTimeout } from '../constants/defaultTimeout';

export const getTimeout = ({ override }: { override?: number }): number => override ?? defaultTimeout;
