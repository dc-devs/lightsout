import type { Config } from './common/types/Config';

export const saveConfig = ({ path, config }: { path: string; config: Config }): string => `${path}:${config.name}`;
