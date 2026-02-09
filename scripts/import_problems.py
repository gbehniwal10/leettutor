"""
Import problems from newfacade/LeetCodeDataset on HuggingFace.
Filters to NeetCode 150 list, converts to our JSON schema,
and writes to backend/problems/.

Usage: python scripts/import_problems.py
"""

import json
import re
import ast
import sys
from pathlib import Path
from datasets import load_dataset

OUTPUT_DIR = Path(__file__).parent.parent / "backend" / "problems"
OUTPUT_DIR.mkdir(exist_ok=True)

# NeetCode 150 problem slugs
NEETCODE_150 = [
    # Arrays & Hashing
    "contains-duplicate", "valid-anagram", "two-sum", "group-anagrams",
    "top-k-frequent-elements", "encode-and-decode-strings", "product-of-array-except-self",
    "valid-sudoku", "longest-consecutive-sequence",
    # Two Pointers
    "valid-palindrome", "two-sum-ii-input-array-is-sorted", "3sum",
    "container-with-most-water", "trapping-rain-water",
    # Sliding Window
    "best-time-to-buy-and-sell-stock", "longest-substring-without-repeating-characters",
    "longest-repeating-character-replacement", "permutation-in-string",
    "minimum-window-substring", "sliding-window-maximum",
    # Stack
    "valid-parentheses", "min-stack", "evaluate-reverse-polish-notation",
    "generate-parentheses", "daily-temperatures", "car-fleet",
    "largest-rectangle-in-histogram",
    # Binary Search
    "binary-search", "search-a-2d-matrix", "koko-eating-bananas",
    "find-minimum-in-rotated-sorted-array", "search-in-rotated-sorted-array",
    "time-based-key-value-store", "median-of-two-sorted-arrays",
    # Linked List
    "reverse-linked-list", "merge-two-sorted-lists", "reorder-list",
    "remove-nth-node-from-end-of-list", "copy-list-with-random-pointer",
    "add-two-numbers", "linked-list-cycle", "find-the-duplicate-number",
    "lru-cache", "merge-k-sorted-lists", "reverse-nodes-in-k-group",
    # Trees
    "invert-binary-tree", "maximum-depth-of-binary-tree",
    "diameter-of-binary-tree", "balanced-binary-tree",
    "same-tree", "subtree-of-another-tree",
    "lowest-common-ancestor-of-a-binary-search-tree",
    "binary-tree-level-order-traversal", "binary-tree-right-side-view",
    "count-good-nodes-in-binary-tree", "validate-binary-search-tree",
    "kth-smallest-element-in-a-bst", "construct-binary-tree-from-preorder-and-inorder-traversal",
    "binary-tree-maximum-path-sum", "serialize-and-deserialize-binary-tree",
    # Tries
    "implement-trie-prefix-tree", "design-add-and-search-words-data-structure",
    "word-search-ii",
    # Heap / Priority Queue
    "kth-largest-element-in-a-stream", "last-stone-weight",
    "k-closest-points-to-origin", "kth-largest-element-in-an-array",
    "task-scheduler", "design-twitter", "find-median-from-data-stream",
    # Backtracking
    "subsets", "combination-sum", "permutations", "subsets-ii",
    "combination-sum-ii", "word-search", "palindrome-partitioning",
    "letter-combinations-of-a-phone-number", "n-queens",
    # Graphs
    "number-of-islands", "max-area-of-island", "clone-graph",
    "walls-and-gates", "rotting-oranges", "pacific-atlantic-water-flow",
    "surrounded-regions", "course-schedule", "course-schedule-ii",
    "graph-valid-tree", "number-of-connected-components-in-an-undirected-graph",
    "redundant-connection", "word-ladder",
    # Advanced Graphs
    "reconstruct-itinerary", "min-cost-to-connect-all-points",
    "network-delay-time", "swim-in-rising-water",
    "alien-dictionary", "cheapest-flights-within-k-stops",
    # 1-D Dynamic Programming
    "climbing-stairs", "min-cost-climbing-stairs", "house-robber",
    "house-robber-ii", "longest-palindromic-substring",
    "palindromic-substrings", "decode-ways", "coin-change",
    "maximum-product-subarray", "word-break",
    "longest-increasing-subsequence", "partition-equal-subset-sum",
    # 2-D Dynamic Programming
    "unique-paths", "longest-common-subsequence", "best-time-to-buy-and-sell-stock-with-cooldown",
    "coin-change-ii", "target-sum", "interleaving-string",
    "longest-increasing-path-in-a-matrix", "distinct-subsequences",
    "edit-distance", "burst-balloons", "regular-expression-matching",
    # Greedy
    "maximum-subarray", "jump-game", "jump-game-ii",
    "gas-station", "hand-of-straights", "merge-triplets-to-form-target-triplet",
    "partition-labels", "valid-parenthesis-string",
    # Intervals
    "insert-interval", "merge-intervals", "non-overlapping-intervals",
    "meeting-rooms", "meeting-rooms-ii", "minimum-interval-to-include-each-query",
    # Math & Geometry
    "rotate-image", "spiral-matrix", "set-matrix-zeroes",
    "happy-number", "plus-one", "pow-x-n",
    "multiply-strings", "detect-squares",
    # Bit Manipulation
    "single-number", "number-of-1-bits", "counting-bits",
    "reverse-bits", "missing-number", "sum-of-two-integers",
    "reverse-integer",
]


def parse_input_string(input_str: str) -> dict:
    """Parse 'nums = [1,2,3], target = 9' into {'nums': [1,2,3], 'target': 9}"""
    result = {}
    # Split on top-level commas (not inside brackets)
    # Use regex to find key = value pairs
    pairs = re.findall(r'(\w+)\s*=\s*(.+?)(?=,\s*\w+\s*=|$)', input_str)
    for key, val in pairs:
        val = val.strip().rstrip(',')
        try:
            parsed = ast.literal_eval(val)
            # Reject non-JSON-serializable values
            if parsed is Ellipsis:
                return {}
            result[key] = parsed
        except (ValueError, SyntaxError):
            if val.lower() == 'null' or val == 'None':
                result[key] = None
            elif val.lower() == 'true':
                result[key] = True
            elif val.lower() == 'false':
                result[key] = False
            else:
                result[key] = val
    return result


def parse_output_string(output_str: str):
    """Parse output string into Python value."""
    output_str = output_str.strip()
    if output_str.lower() == 'null' or output_str == 'None':
        return None
    if output_str.lower() == 'true':
        return True
    if output_str.lower() == 'false':
        return False
    try:
        return ast.literal_eval(output_str)
    except (ValueError, SyntaxError):
        return output_str


def extract_function_name(starter_code: str) -> str | None:
    """Extract function name from class Solution starter code."""
    # Remove comment lines first to avoid matching commented-out __init__
    lines = [l for l in starter_code.split('\n') if not l.strip().startswith('#')]
    clean = '\n'.join(lines)
    match = re.search(r'def\s+(\w+)\s*\(self', clean)
    return match.group(1) if match else None


def _modernize_type_hints(code: str) -> str:
    """Convert typing-style hints (List, Optional, etc.) to Python 3.10+ builtins."""
    # Resolve Optional[X] → X | None (handle nested brackets)
    changed = True
    while changed:
        changed = False
        new = re.sub(r'Optional\[([^\[\]]*(?:\[[^\[\]]*\])*[^\[\]]*)\]', r'\1 | None', code)
        if new != code:
            code = new
            changed = True
    code = code.replace('List[', 'list[')
    code = code.replace('Dict[', 'dict[')
    code = code.replace('Tuple[', 'tuple[')
    code = code.replace('Set[', 'set[')
    return code


def convert_starter_code(starter_code: str, func_name: str) -> str:
    """Convert class Solution format to standalone function."""
    # Remove class definition and comment lines
    lines = starter_code.split('\n')
    new_lines = []
    skip_class = False
    for line in lines:
        stripped = line.strip()
        # Skip class Solution line
        if stripped.startswith('class Solution'):
            skip_class = True
            continue
        # Skip comment-only lines before the def (like ListNode definition comments)
        if skip_class and stripped.startswith('#'):
            continue
        # Found the def — convert it
        if stripped.startswith(f'def {func_name}(self'):
            # Remove self parameter
            line = line.replace(f'def {func_name}(self, ', f'def {func_name}(')
            line = line.replace(f'def {func_name}(self)', f'def {func_name}()')
            skip_class = False
        # Dedent by 4 spaces (was inside class)
        if line.startswith('    '):
            line = line[4:]
        new_lines.append(line)

    result = '\n'.join(new_lines).strip()
    if not result.endswith('\n'):
        result += '\n'
    # Ensure it ends with pass if body is empty
    if result.strip().endswith(':'):
        result += '    # Your code here\n    pass\n'
    # Modernize type hints: List[int] → list[int], Optional[X] → X | None
    result = _modernize_type_hints(result)
    return result


def detect_data_structure_type(test_str: str, starter_code: str) -> str | None:
    """Detect if problem uses linked list or tree data structures. Returns type or None."""
    if 'list_node' in test_str or 'is_same_list' in test_str or 'ListNode' in starter_code:
        return 'linked_list'
    if 'tree_node' in test_str or 'is_same_tree' in test_str or 'TreeNode' in starter_code:
        return 'tree'
    return None


# Parameter names that should be converted to ListNode
LINKED_LIST_PARAMS = {'head', 'list1', 'list2', 'l1', 'l2', 'node', 'head1', 'head2'}
# Parameter names that should be converted to TreeNode
TREE_PARAMS = {'root', 'tree', 'root1', 'root2', 'p', 'q'}
# Problems that need special handling and should be skipped
SKIP_PROBLEMS = {'copy-list-with-random-pointer'}
# Parameters that need cycle construction (head + pos)
CYCLE_PARAMS = {'pos'}


def difficulty_map(d: str) -> str:
    return d.lower().strip()


def build_function_call(func_name: str, input_dict: dict, ds_type: str | None, returns_ds: bool) -> str:
    """Build a function_call string that handles data structure conversions."""
    if not ds_type:
        return f"{func_name}(**test_input)"

    # Detect cycle pattern: linked list param + pos param together
    has_cycle = ds_type == 'linked_list' and 'pos' in input_dict and any(k in LINKED_LIST_PARAMS for k in input_dict)

    # Build argument list with conversions for ds params
    args = []
    for key in input_dict:
        if has_cycle and key in LINKED_LIST_PARAMS:
            args.append(f"{key}=list_node_with_cycle(test_input['{key}'], test_input.get('pos', -1))")
        elif has_cycle and key == 'pos':
            continue  # pos is consumed by list_node_with_cycle
        elif ds_type == 'linked_list' and key in LINKED_LIST_PARAMS:
            args.append(f"{key}=list_node(test_input['{key}'])")
        elif ds_type == 'tree' and key in TREE_PARAMS:
            args.append(f"{key}=tree_node(test_input['{key}'])")
        else:
            args.append(f"{key}=test_input['{key}']")

    call = f"{func_name}({', '.join(args)})"

    # Wrap result if function returns a data structure
    if returns_ds:
        if ds_type == 'linked_list':
            call = f"list_node_to_list({call})"
        elif ds_type == 'tree':
            call = f"tree_node_to_list({call})"

    return call


def detect_returns_ds(test_str: str, ds_type: str | None) -> bool:
    """Check if the function returns a data structure (vs bool/int/etc)."""
    if not ds_type:
        return False
    if ds_type == 'linked_list':
        return 'is_same_list' in test_str
    if ds_type == 'tree':
        return 'is_same_tree' in test_str
    return False


def convert_problem(row: dict) -> dict | None:
    """Convert a dataset row to our problem schema. Returns None if can't convert."""
    task_id = row['task_id']

    if task_id in SKIP_PROBLEMS:
        print(f"  SKIP {task_id}: needs special handling")
        return None

    func_name = extract_function_name(row['starter_code'])
    if not func_name:
        return None

    # Detect data structure type
    ds_type = detect_data_structure_type(row.get('test', ''), row.get('starter_code', ''))
    returns_ds = detect_returns_ds(row.get('test', ''), ds_type)

    # Parse test cases from input_output
    test_cases = []
    first_input = None
    for io in row.get('input_output', []):
        try:
            # Skip error outputs from dataset
            if io.get('output', '').startswith('Error:'):
                continue
            inp = parse_input_string(io['input'])
            out = parse_output_string(io['output'])
            if not inp:
                continue
            if first_input is None:
                first_input = inp
            func_call = build_function_call(func_name, inp, ds_type, returns_ds)
            test_cases.append({
                "input": inp,
                "expected": out,
                "function_call": func_call,
            })
        except Exception as e:
            continue

    if len(test_cases) < 2:
        print(f"  SKIP {task_id}: only {len(test_cases)} parseable test cases")
        return None

    # Split: first 3 visible, rest hidden (cap hidden at 20)
    visible = test_cases[:3]
    hidden = test_cases[3:23]

    # Convert starter code
    starter = convert_starter_code(row['starter_code'], func_name)

    # Clean up description
    description = row.get('problem_description', '').strip()

    # Build tags (lowercase)
    tags = [t.lower().replace(' ', '-') for t in row.get('tags', [])]

    problem = {
        "id": task_id,
        "title": task_id.replace('-', ' ').title(),
        "difficulty": difficulty_map(row.get('difficulty', 'medium')),
        "tags": tags,
        "description": description,
        "starter_code": starter,
        "function_name": func_name,
        "test_cases": visible,
        "hidden_test_cases": hidden,
        "hints": [],
        "optimal_complexity": {"time": "", "space": ""},
    }

    if ds_type:
        problem["helpers"] = ["data_structures"]

    return problem


def main():
    print("Loading LeetCodeDataset from HuggingFace...")
    ds = load_dataset('newfacade/LeetCodeDataset', split='train')
    print(f"Dataset has {len(ds)} problems")

    # Index by task_id
    by_slug = {row['task_id']: row for row in ds}

    # Get existing problems (don't overwrite)
    existing = {f.stem for f in OUTPUT_DIR.glob("*.json")}
    print(f"Existing problems: {len(existing)}")

    imported = 0
    skipped_missing = 0
    skipped_convert = 0
    skipped_existing = 0

    for slug in NEETCODE_150:
        if slug in existing:
            skipped_existing += 1
            continue

        if slug not in by_slug:
            # Try alternate slug formats
            alt_slug = slug  # Could try variations
            if alt_slug not in by_slug:
                print(f"  MISSING {slug}: not in dataset")
                skipped_missing += 1
                continue

        row = by_slug[slug]
        problem = convert_problem(row)
        if not problem:
            skipped_convert += 1
            continue

        # Validate JSON-serializability before writing
        try:
            json_str = json.dumps(problem, indent=2, ensure_ascii=False)
        except (TypeError, ValueError) as e:
            print(f"  SKIP {slug}: JSON serialize error: {e}")
            skipped_convert += 1
            continue

        out_path = OUTPUT_DIR / f"{slug}.json"
        out_path.write_text(json_str, encoding='utf-8')
        imported += 1
        print(f"  OK {slug} ({problem['difficulty']}, {len(problem['test_cases'])}+{len(problem['hidden_test_cases'])} tests)")

    print(f"\nDone! Imported: {imported}, Skipped existing: {skipped_existing}, "
          f"Missing from dataset: {skipped_missing}, Convert failed: {skipped_convert}")
    print(f"Total problems in {OUTPUT_DIR}: {len(list(OUTPUT_DIR.glob('*.json')))}")


if __name__ == "__main__":
    main()
