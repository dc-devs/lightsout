/**
 * What a preference resolves to once the operating system's own preference is
 * known — and the class the `<html>` element carries.
 *
 * Separate from `Theme` because `System` is never a rendered class.
 */
export const ResolvedTheme = { Light: 'light', Dark: 'dark' } as const;

export type ResolvedTheme = (typeof ResolvedTheme)[keyof typeof ResolvedTheme];
