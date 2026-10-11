# Cross-surface visibility case, 2026-10-11

An anonymized real-project observation motivated this case. A new-account dialog lets an operator select applications. A separate account-management view has an individual “show in portal” control and a count of currently visible applications. The two views present related business concepts but do not necessarily show the same state.

Source inspection and an isolated local reproduction found three distinct meanings:

1. A checked option in the invitation dialog can mean a planned individual assignment. A checked, disabled option can instead mean that a published offer makes the application globally visible; disabled HTML controls are not submitted as individual selections.
2. The invitation saves submitted individual assignments while the account is pending.
3. The management count uses the effective access decision. A pending account has no effective visibility until activation, even if its planned assignments are stored. The management checkbox itself reflects only the individual assignment.

The screenshots supplied for the observation displayed different accounts, so they do not prove a failed assignment for one account. The local reproduction used synthetic accounts only and confirmed a pending account with one saved assignment, no effective visibility, a `0 von 2` management count, and a globally visible option checked and disabled in the dialog. Existing invitation tests passed 9/9; they did not exercise the complete invitation-to-management presentation contract for pending and active states.

## FeatureNetwork implication

Model the invitation input, saved assignment, effective visibility and management/portal views as separate features when the inspected project supports that split. Add evidenced relations across their actual source paths, with `when` for pending/active states and `check` for observable behavior. A development agent should start impact from the changed input feature, traverse incoming dependents, inspect the returned views and tests, and verify the business meaning of each control and count. A missing edge is a visible coverage gap, never proof that no other view is affected.

The regression in `tests/query/impact.test.ts` proves that the current graph can return both management and portal effects **when the edges are present**, and that an omitted management edge remains undiscovered. The skill contract test checks that initialization, development and sync instructions mention this cross-surface review. These are core/instruction checks, not evidence that an installed agent notices and fixes such a defect in a real project. That requires a separate held-out agent trial with an initialized network, actual host tool calls, unchanged task wording and behavioral acceptance tests for pending and active accounts, global offers, stored assignments, management display, and access decisions.
