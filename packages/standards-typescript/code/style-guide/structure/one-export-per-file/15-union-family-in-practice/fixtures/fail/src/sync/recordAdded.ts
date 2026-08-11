import type { FileAddedEvent } from '@/common/types/SyncEvent';

export const recordAdded = (event: FileAddedEvent): string => event.path;
