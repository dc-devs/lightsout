/**
 * How many source files one plan or phase may create or modify before the
 * feature executor stops with `terminated:scope` — the default for the
 * `executor-file-limit` config key.
 *
 * It is one number rather than four hand-typed copies because the planning
 * checks and the implementing agent must agree by construction: a plan that
 * grades A against a softer planning number and is then refused at implement
 * time has cost a whole run to learn something the lint already knew.
 */
export const defaultExecutorFileLimit = 50;
