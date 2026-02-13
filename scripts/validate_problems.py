#!/usr/bin/env python3
"""
Validate and fix problem JSON files.

Usage:
    python scripts/validate_problems.py --check           # report issues, exit 1 if any
    python scripts/validate_problems.py --fix             # auto-repair and report
    python scripts/validate_problems.py --check foo.json  # check a single file

Can also be imported by import_problems.py to validate at import time.
"""

import json
import re
import sys
from pathlib import Path

PROBLEMS_DIR = Path(__file__).parent.parent / "backend" / "problems"

# Files in the problems directory that aren't problem definitions
_SKIP_FILES = {"skill-tree.json"}

# --- Issue detection ---

# Matches strings that look like Python expressions: "x" * N, [...] * N, range(...)
_PYTHON_EXPR_RE = re.compile(
    r'(".*?"\s*\*\s*\d+)|(\[.*?\]\s*\*\s*\d+)|(range\s*\()'
)

# Matches error messages in expected values
_ERROR_EXPECTED_RE = re.compile(
    r'Error:|Traceback|missing \d+ required positional argument|'
    r'takes \d+ positional argument|index out of range|'
    r'object is not (subscriptable|iterable|callable)',
    re.IGNORECASE,
)

# Required top-level fields
_REQUIRED_FIELDS = {"id", "title", "difficulty", "tags", "description",
                    "starter_code", "function_name", "test_cases"}


def _try_parse_json(s):
    """Try to parse a string as JSON. Returns (parsed, True) or (original, False)."""
    try:
        val = json.loads(s)
        if isinstance(val, (list, dict)):
            return val, True
    except (json.JSONDecodeError, TypeError):
        pass
    return s, False


def validate_problem(data, filepath=None):
    """Validate a single problem dict. Returns list of issue dicts."""
    issues = []
    fname = Path(filepath).name if filepath else "<unknown>"

    # Schema checks
    for field in _REQUIRED_FIELDS:
        if field not in data:
            issues.append({
                "file": fname, "section": "schema", "index": None,
                "field": field, "kind": "missing_field",
                "detail": f"Required field '{field}' is missing",
                "fixable": False,
            })

    # Approaches field validation
    approaches = data.get("approaches")
    if approaches is None:
        issues.append({
            "file": fname, "section": "schema", "index": None,
            "field": "approaches", "kind": "missing_field",
            "detail": "Required field 'approaches' is missing",
            "fixable": False,
        })
    elif not isinstance(approaches, list) or len(approaches) == 0:
        issues.append({
            "file": fname, "section": "schema", "index": None,
            "field": "approaches", "kind": "invalid_approaches",
            "detail": "Field 'approaches' must be a non-empty list",
            "fixable": False,
        })
    elif not all(isinstance(a, str) and a.strip() for a in approaches):
        issues.append({
            "file": fname, "section": "schema", "index": None,
            "field": "approaches", "kind": "invalid_approaches",
            "detail": "All entries in 'approaches' must be non-empty strings",
            "fixable": False,
        })

    if data.get("function_name") and data.get("starter_code"):
        if data["function_name"] not in data["starter_code"]:
            issues.append({
                "file": fname, "section": "schema", "index": None,
                "field": "function_name", "kind": "name_mismatch",
                "detail": f"function_name '{data['function_name']}' not found in starter_code",
                "fixable": False,
            })

    # Test case checks
    for section in ("test_cases", "hidden_test_cases"):
        for i, tc in enumerate(data.get(section, [])):
            # Check inputs
            for key, val in tc.get("input", {}).items():
                if isinstance(val, str):
                    stripped = val.strip()

                    # Stringified JSON array or object
                    if ((stripped.startswith("[") and stripped.endswith("]")) or
                            (stripped.startswith("{") and stripped.endswith("}"))):
                        _, parseable = _try_parse_json(stripped)
                        if parseable:
                            issues.append({
                                "file": fname, "section": section, "index": i,
                                "field": f"input.{key}", "kind": "stringified_json",
                                "detail": f"JSON array/object stored as string: {val[:60]}...",
                                "fixable": True,
                            })

                    # Python expression
                    if _PYTHON_EXPR_RE.search(stripped):
                        issues.append({
                            "file": fname, "section": section, "index": i,
                            "field": f"input.{key}", "kind": "python_expression",
                            "detail": f"Looks like unevaluated Python: {val[:60]}",
                            "fixable": False,
                        })

            # Check expected value
            exp = tc.get("expected")
            if isinstance(exp, str) and _ERROR_EXPECTED_RE.search(exp):
                issues.append({
                    "file": fname, "section": section, "index": i,
                    "field": "expected", "kind": "error_expected",
                    "detail": f"Expected is an error message: {exp[:80]}",
                    "fixable": True,  # fix = remove the test case
                })

            # Check function_call references test_input
            fc = tc.get("function_call", "")
            if fc and "test_input" not in fc:
                issues.append({
                    "file": fname, "section": section, "index": i,
                    "field": "function_call", "kind": "bad_function_call",
                    "detail": f"function_call doesn't reference test_input: {fc}",
                    "fixable": False,
                })

    return issues


def fix_problem(data):
    """Apply auto-fixes to a problem dict in-place. Returns (num_fixed, num_removed)."""
    num_fixed = 0
    num_removed = 0

    for section in ("test_cases", "hidden_test_cases"):
        cases = data.get(section, [])
        to_remove = []

        for i, tc in enumerate(cases):
            # Fix stringified JSON in inputs
            for key, val in list(tc.get("input", {}).items()):
                if isinstance(val, str):
                    parsed, ok = _try_parse_json(val.strip())
                    if ok:
                        tc["input"][key] = parsed
                        num_fixed += 1

            # Mark test cases with error expectations for removal
            exp = tc.get("expected")
            if isinstance(exp, str) and _ERROR_EXPECTED_RE.search(exp):
                to_remove.append(i)

        # Remove broken test cases (reverse order to preserve indices)
        for i in reversed(to_remove):
            cases.pop(i)
            num_removed += 1

    return num_fixed, num_removed


def validate_file(filepath):
    """Load and validate a single problem file. Returns issues list."""
    with open(filepath) as f:
        data = json.load(f)
    return validate_problem(data, filepath)


def fix_file(filepath):
    """Load, fix, and rewrite a single problem file. Returns (issues_before, fixed, removed)."""
    with open(filepath) as f:
        data = json.load(f)
    issues_before = validate_problem(data, filepath)
    if not issues_before:
        return [], 0, 0
    num_fixed, num_removed = fix_problem(data)
    if num_fixed > 0 or num_removed > 0:
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    return issues_before, num_fixed, num_removed


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Validate/fix problem JSON files")
    parser.add_argument("--check", action="store_true", help="Report issues (exit 1 if any)")
    parser.add_argument("--fix", action="store_true", help="Auto-repair fixable issues")
    parser.add_argument("path", nargs="?", default=None,
                        help="Single file or directory (default: backend/problems/)")
    args = parser.parse_args()

    if not args.check and not args.fix:
        parser.error("Specify --check or --fix")

    # Resolve target files
    target = Path(args.path) if args.path else PROBLEMS_DIR
    if target.is_file():
        files = [target]
    elif target.is_dir():
        files = sorted(f for f in target.glob("*.json") if f.name not in _SKIP_FILES)
    else:
        print(f"Error: {target} not found", file=sys.stderr)
        sys.exit(1)

    total_issues = 0
    total_fixed = 0
    total_removed = 0
    files_affected = 0

    for fpath in files:
        if args.fix:
            issues, fixed, removed = fix_file(fpath)
            if issues:
                files_affected += 1
                total_issues += len(issues)
                total_fixed += fixed
                total_removed += removed
                print(f"{fpath.name}: {len(issues)} issues, {fixed} inputs fixed, {removed} test cases removed")
                unfixable = [iss for iss in issues if not iss["fixable"]]
                for iss in unfixable:
                    print(f"  MANUAL: {iss['section']}[{iss['index']}].{iss['field']}: {iss['detail']}")
        else:
            issues = validate_file(fpath)
            if issues:
                files_affected += 1
                total_issues += len(issues)
                print(f"{fpath.name}: {len(issues)} issues")
                for iss in issues:
                    tag = "FIXABLE" if iss["fixable"] else "MANUAL"
                    loc = f"{iss['section']}[{iss['index']}]" if iss["index"] is not None else iss["section"]
                    print(f"  [{tag}] {loc}.{iss['field']}: {iss['detail']}")

    # Summary
    print(f"\n{'='*50}")
    print(f"Files scanned: {len(files)}")
    print(f"Files with issues: {files_affected}")
    print(f"Total issues: {total_issues}")
    if args.fix:
        print(f"Inputs fixed: {total_fixed}")
        print(f"Test cases removed: {total_removed}")

    # Verify after fix
    if args.fix:
        remaining = 0
        for fpath in files:
            remaining += len(validate_file(fpath))
        if remaining:
            print(f"Remaining issues (need manual fix): {remaining}")
        else:
            print("All fixable issues resolved!")

    if args.check and total_issues > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
