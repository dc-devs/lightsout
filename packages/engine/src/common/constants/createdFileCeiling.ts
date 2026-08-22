/**
 * How many source files one plan or phase may create before the structural
 * lint refuses it.
 *
 * Created files, not touched files, are what a plan has to specify: a created
 * file needs its signatures, exports and behaviour written out, while a file
 * whose import name changes needs one line. A deliberately mechanical
 * hundred-file rename must stay legal as one phase; a fifty-file authoring
 * phase must not.
 */
export const createdFileCeiling = 30;
