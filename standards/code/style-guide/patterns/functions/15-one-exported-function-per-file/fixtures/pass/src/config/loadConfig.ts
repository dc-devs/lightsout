import type { Config } from './common/types/Config';

export const loadConfig = ({ path }: { path: string }): Config => ({ name: path });
