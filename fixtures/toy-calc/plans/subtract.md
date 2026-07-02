# Plan: add subtract operation

## Goal

Add a `subtract` operation to the calculator, mirroring the existing `add`
operation exactly.

## Files

1. **Create `src/subtract.js`** — export a `subtract` function with the same
   object-parameter shape as `src/add.js` (`{ number1, number2 }`), returning
   `number1 - number2`. Mirror `src/add.js` style exactly.
2. **Modify `src/index.js`** — additionally re-export `subtract` from
   `./subtract.js`, same style as the existing re-exports.

## Out of scope

Everything else. Do not modify other source files.
