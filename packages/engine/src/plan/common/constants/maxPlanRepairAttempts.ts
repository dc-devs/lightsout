/**
 * How many times a plan-repair loop may re-spawn against typed findings before
 * the survivors are handed back to the session.
 *
 * One number for both loops — the structural repair and the phase-breakdown
 * reshape — because they are the same bargain: a bounded number of cheap
 * corrections, then a human.
 */
export const maxPlanRepairAttempts = 3;
