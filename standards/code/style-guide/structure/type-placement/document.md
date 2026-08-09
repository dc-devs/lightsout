# Type & Constant Placement

These placement rules govern **shared** declarations. An exported type or
constant with no second consumer is a file-module wherever its consumers live
— `common/` placement is earned by sharing, never by kind (see the Code
Placement Philosophy in architecture-decisions.md).
