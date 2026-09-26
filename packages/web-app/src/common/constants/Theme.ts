/** The theme a viewer chose — and the class the `<html>` element carries for it. */
export const Theme = { Light: 'light', Dark: 'dark' } as const;

export type Theme = (typeof Theme)[keyof typeof Theme];
