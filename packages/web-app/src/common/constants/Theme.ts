/**
 * What a viewer asked for, which is not always what gets rendered:
 * `Theme.System` is a request to follow the operating system rather than a
 * colour of its own.
 */
export const Theme = { Light: 'light', Dark: 'dark', System: 'system' } as const;

export type Theme = (typeof Theme)[keyof typeof Theme];
