# Folder Structure

Use a `common/` folder pattern for shared code — it keeps related code local, makes dependency scope visible, and scales by promoting code upward only when reuse is proven. The trees below are **folder-modules** (see [Modules & the Graduation Rule](./architecture-decisions.md#modules--the-graduation-rule)): a feature folder's `index.ts` is its public API; everything under its `common/` is internal.
