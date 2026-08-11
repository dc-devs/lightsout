import type { FileAddedEvent } from '@/common/types/FileAddedEvent';

export const recordAdded = (event: FileAddedEvent): string => event.path;
