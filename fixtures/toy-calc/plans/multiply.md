# Plan: add multiply operation

## Goal

Add a `multiply` operation to the calculator, mirroring the existing `add`
operation exactly.

## Files

1. **Create `src/multiply.js`** — export a `multiply` function with the same
   object-parameter shape as `src/add.js` (`{ number1, number2 }`), returning
   the product. Mirror `src/add.js` style exactly.
2. **Modify `src/index.js`** — additionally re-export `multiply` from
   `./multiply.js`, same style as the existing `add` re-export.
3. **Create `test/multiply.test.js`** — mirror `test/add.test.js`: import
   `multiply` from `../src/index.js`, cover (a) two positive numbers,
   (b) multiplication by zero.

## Out of scope

Everything else. Do not modify `src/add.js` or `test/add.test.js`.
