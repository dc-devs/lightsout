# Plan: add divide operation

## Goal

Add a `divide` operation to the calculator, mirroring the existing operations.

## Files

1. **Create `src/divide.js`** — export a `divide` function with the same
   object-parameter shape as the other operations (`{ number1, number2 }`).
   Return `number1 / number2`; when `number2` is `0`, return `null`.
2. **Modify `src/index.js`** — additionally re-export `divide` from
   `./divide.js`, same style as the existing re-exports.

## Out of scope

Everything else. Do not modify other source files.
