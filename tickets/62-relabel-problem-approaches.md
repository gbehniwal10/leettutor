# Ticket 62: Relabel Problem Approaches Across Dataset

## Problem

The `approaches` field in our 138 problem JSON files was auto-generated with a weak prompt. A quality audit found pervasive issues:

- **Complexity labels masquerading as technique names**: "Memoization O(n)", "Dynamic Programming O(n)" — these are complexity tiers, not distinct techniques
- **Constraint violations**: Approaches listed that violate the problem's own requirements (e.g. "Linear Search O(n)" on a problem requiring O(log n))
- **Generic/vague names**: "Brute Force O(n^2)", "One Pass O(n)", "Sort + Merge" with no specifics
- **Missing common approaches**: Students frequently use approaches (e.g. sort + two-pointer for Two Sum) that aren't listed, causing classification misses
- **Inconsistent terminology**: Same technique named differently across problems (e.g. "Memoization" vs "Top-down DP")

## Goal

Relabel the `approaches` field for all 138 problems with high-quality, specific technique names that the approach classifier can reliably match against student solutions.

## Schema Change

Change the `approaches` field from a flat string array to structured objects:

```json
{
  "approaches": [
    { "name": "Iterative Two-Pointer", "complexity": { "time": "O(log n)", "space": "O(1)" } },
    { "name": "Recursive Binary Search", "complexity": { "time": "O(log n)", "space": "O(log n)" } }
  ]
}
```

## Labeling Criteria

### 1. Naming Rules

- **Name the technique, not the complexity**. "Top-down Memoization" not "Memoization O(n)". "Kadane's Algorithm" not "One Pass O(n)".
- **Be specific about the data structure or pattern** when it's the distinguishing factor. "Monotonic Stack" not "Stack". "Min-Heap of size k" not "Heap".
- **Use established algorithm names** when they exist: "Kadane's Algorithm", "Floyd's Cycle Detection", "Dijkstra's Algorithm", "QuickSelect", "Patience Sorting", "Manacher's Algorithm", etc.
- **Distinguish implementation style** when the algorithm is the same but implementation differs meaningfully: "Iterative Binary Search" vs "Recursive Binary Search" (different space complexity due to call stack).
- **Use consistent terminology** across all problems:
  - "Top-down Memoization" (not "Recursion with Memoization" or just "Memoization")
  - "Bottom-up DP" (not just "Dynamic Programming")
  - "Bottom-up DP (Space-Optimized)" for rolling-array / two-variable variants
  - "Greedy" with specifics: "Greedy (Track Min Price)" not just "Greedy"
  - "Brute Force (Nested Loops)" or "Brute Force (Generate All Subsets)" — always parenthetical specifics

### 2. Which Approaches to Include

- **Only approaches that satisfy the problem's stated constraints.** If the problem says "O(log n) runtime required", do not list O(n) approaches.
- **Include 2-5 approaches per problem.** Most problems have 2-3 genuinely distinct approaches. Don't pad.
- **An approach is "distinct" if it uses a fundamentally different algorithm or data structure**, not just a minor optimization of the same idea. Top-down memoization and bottom-up DP of the same recurrence ARE distinct (different implementation, different space profile). Bottom-up DP and space-optimized DP ARE distinct (different space complexity).
- **Include approaches students actually write**, not just textbook-optimal ones. If students commonly solve Two Sum with sort + two-pointer, list it even if hash-map is better.
- **Don't include approaches that are purely theoretical** or that no student would realistically implement (e.g. "NFA/DFA" for regex matching).

### 3. Complexity Field Rules

- Use standard Big-O notation: `O(n)`, `O(n log n)`, `O(n^2)`, `O(2^n)`
- Use variable names consistent with the problem (n = array length, n*m = grid dimensions, etc.)
- Space complexity should reflect **auxiliary** space (exclude input), and should account for recursion stack depth where applicable

### 4. Examples of Good vs Bad Labels

| Bad | Good |
|-----|------|
| `"Brute Force O(n^2)"` | `"Brute Force (Nested Loops)"` with `{"time": "O(n^2)", "space": "O(1)"}` |
| `"Dynamic Programming O(n)"` | `"Bottom-up DP"` with `{"time": "O(n)", "space": "O(n)"}` |
| `"Memoization O(n)"` | `"Top-down Memoization"` with `{"time": "O(n)", "space": "O(n)"}` |
| `"One Pass O(n)"` | `"Greedy (Track Min Price)"` with `{"time": "O(n)", "space": "O(1)"}` |
| `"Stack O(n)"` | `"Monotonic Stack"` with `{"time": "O(n)", "space": "O(n)"}` |
| `"Sort + Merge O(n log n)"` | `"Sort then Greedy Merge"` with `{"time": "O(n log n)", "space": "O(n)"}` |
| `"Hash Map (Two Pass) O(n)"` | `"Hash Map (Two Pass)"` with `{"time": "O(n)", "space": "O(n)"}` |
| `"Binary Search + DP O(n log n)"` | `"Patience Sorting (Greedy + Binary Search)"` with `{"time": "O(n log n)", "space": "O(n)"}` |
| `"Linear Search O(n)"` (on O(log n) problem) | Remove entirely |

## Execution Plan

### Phase 1: Labeling (subagents)

Split the 138 problems into batches (~20 per agent). Each labeling agent receives:
- The batch of problem JSON files (description, constraints, tags, starter_code)
- This ticket's labeling criteria
- Instructions to output the new `approaches` array for each problem

### Phase 2: Verification (subagents)

A separate set of verification agents each receive:
- A batch of relabeled problems (from Phase 1)
- This ticket's criteria as a checklist
- Instructions to flag any violations:
  - Approach violates problem constraints
  - Name is vague / uses complexity as the name
  - Missing a common student approach
  - Inconsistent terminology with the standards above
  - Fewer than 2 or more than 5 approaches

### Phase 3: Apply & Update Code

1. Write relabeled approaches back to the problem JSON files
2. Update any code that reads the `approaches` field to handle the new object schema:
   - `tutor.py:classify_approach()` — currently matches against a flat string list
   - `solution_store.py` — stores approach as a string
   - Frontend `solutions.js` — displays approach names
   - Import script `scripts/import_problems.py` — if it sets default approaches
3. Run tests to confirm nothing breaks

## Acceptance Criteria

- [ ] All 138 problems have 2-5 structured approach objects
- [ ] No approach violates the problem's stated constraints
- [ ] All names follow the naming rules (technique names, not complexity labels)
- [ ] Terminology is consistent across problems (standardized vocabulary)
- [ ] `classify_approach()` works with the new schema
- [ ] Existing tests pass
