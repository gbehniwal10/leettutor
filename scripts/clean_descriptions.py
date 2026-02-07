"""
Clean up problem descriptions for better markdown rendering.
Fixes: nbsp characters, missing bold headers, code blocks for examples,
proper spacing between sections.
"""
import json
import re
from pathlib import Path

PROBLEMS_DIR = Path(__file__).parent.parent / "backend" / "problems"


def clean_description(desc: str) -> str:
    # 1. Replace non-breaking spaces with regular spaces
    desc = desc.replace("\u00a0", " ")

    # 2. Strip existing code fences so we can re-apply consistently
    desc = re.sub(r"^```\s*$", "", desc, flags=re.MULTILINE)

    # 3. Normalize multiple blank lines to exactly two newlines
    desc = re.sub(r"\n{3,}", "\n\n", desc)

    # 4. Remove lines that are only whitespace
    desc = re.sub(r"^\s+$", "", desc, flags=re.MULTILINE)

    # 5. Strip leading/trailing whitespace
    desc = desc.strip()

    # 6. Strip existing bold markers, then re-apply consistently
    desc = re.sub(r"\*\*(Example\s*\d+):\*\*", r"\1:", desc)
    desc = re.sub(r"\*\*(Constraints):\*\*", r"\1:", desc)
    desc = re.sub(r"\*\*(Follow up):\*\*", r"\1:", desc)
    desc = re.sub(r"\*\*(Note):\*\*", r"\1:", desc)
    # Now bold them all
    desc = re.sub(r"^(Example\s*\d+)\s*:", r"**\1:**", desc, flags=re.MULTILINE)
    desc = re.sub(r"^(Constraints)\s*:", r"**\1:**", desc, flags=re.MULTILINE)
    desc = re.sub(r"^(Follow up)\s*:", r"**\1:**", desc, flags=re.MULTILINE)
    desc = re.sub(r"^(Note)\s*:", r"**\1:**", desc, flags=re.MULTILINE)

    # 7. Wrap Input/Output/Explanation blocks in code fences
    lines = desc.split("\n")
    new_lines = []
    in_example_block = False
    example_buffer = []

    def flush_example():
        nonlocal in_example_block, example_buffer
        if example_buffer:
            new_lines.append("```")
            new_lines.extend(example_buffer)
            new_lines.append("```")
        in_example_block = False
        example_buffer = []

    for line in lines:
        stripped = line.strip()
        is_io_line = re.match(r"^(Input|Output|Explanation)\s*:", stripped)

        if is_io_line:
            if not in_example_block:
                in_example_block = True
                example_buffer = []
            example_buffer.append(stripped)
        elif in_example_block:
            # Check if this is continuation text (part of explanation)
            # or a section break
            is_section = (
                stripped == ""
                or stripped.startswith("**")
                or stripped.startswith("Constraint")
                or stripped.startswith("Follow")
                or stripped.startswith("Note")
            )
            if is_section:
                flush_example()
                new_lines.append(line)
            else:
                # Continuation of explanation text
                example_buffer.append(stripped)
        else:
            new_lines.append(line)

    flush_example()
    desc = "\n".join(new_lines)

    # 8. Ensure blank line before bold headers
    desc = re.sub(r"([^\n])\n(\*\*)", r"\1\n\n\2", desc)

    # 9. Ensure blank line before code fences (but not inside them)
    desc = re.sub(r"([^\n])\n```", r"\1\n\n```", desc)
    # Remove any blank line right after opening fence (inside the block)
    desc = re.sub(r"```\n\n", r"```\n", desc)

    # 10. Clean up constraint items - make them a bullet list with code formatting
    lines = desc.split("\n")
    in_constraints = False
    result = []
    for line in lines:
        if "**Constraints:**" in line:
            in_constraints = True
            result.append(line)
            continue
        if in_constraints:
            stripped = line.strip()
            if stripped == "":
                result.append(line)
                continue
            if stripped.startswith("**") or stripped.startswith("```"):
                in_constraints = False
                result.append(line)
                continue
            # Make constraint items into list items
            # Note: "-10 <= x" starts with dash but is a negative number, not a bullet
            is_already_bullet = (
                stripped.startswith("- ") and not re.match(r"^-\d", stripped)
            )
            if stripped and not is_already_bullet and not stripped.startswith("*"):
                result.append(f"- `{stripped}`")
            else:
                result.append(line)
        else:
            result.append(line)
    desc = "\n".join(result)

    # 11. Final cleanup: normalize multiple blank lines
    desc = re.sub(r"\n{3,}", "\n\n", desc)

    return desc.strip() + "\n"


def main():
    problems = sorted(PROBLEMS_DIR.glob("*.json"))
    print(f"Processing {len(problems)} problems...")

    for f in problems:
        data = json.loads(f.read_text())
        original = data.get("description", "")
        cleaned = clean_description(original)

        if cleaned != original:
            data["description"] = cleaned
            f.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            print(f"  cleaned: {f.stem}")
        else:
            print(f"  unchanged: {f.stem}")

    print("Done!")


if __name__ == "__main__":
    main()
