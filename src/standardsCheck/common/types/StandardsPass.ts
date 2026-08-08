import type { StandardsFinding } from '@/contracts';
import type { StandardsPassParams } from '@/standardsCheck/common/types/StandardsPassParams';

export type StandardsPass = (params: StandardsPassParams) => Promise<StandardsFinding[]>;
