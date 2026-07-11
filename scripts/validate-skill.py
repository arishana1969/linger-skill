#!/usr/bin/env python3
from pathlib import Path
import re
import sys
import yaml


def main() -> int:
    skill = Path(sys.argv[1] if len(sys.argv) > 1 else "skills/continuity")
    document = skill / "SKILL.md"
    if not document.is_file():
        raise SystemExit(f"missing {document}")
    content = document.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", content, re.DOTALL)
    if not match:
        raise SystemExit("SKILL.md requires YAML frontmatter")
    metadata = yaml.safe_load(match.group(1))
    if set(metadata) != {"name", "description"}:
        raise SystemExit("frontmatter must contain only name and description")
    if metadata["name"] != skill.name or not re.fullmatch(r"[a-z0-9-]{1,63}", metadata["name"]):
        raise SystemExit("invalid skill name")
    if not isinstance(metadata["description"], str) or len(metadata["description"].strip()) < 40:
        raise SystemExit("description is too short")
    interface = yaml.safe_load((skill / "agents" / "openai.yaml").read_text(encoding="utf-8"))
    prompt = interface.get("interface", {}).get("default_prompt", "")
    if f"${metadata['name']}" not in prompt:
        raise SystemExit("default_prompt must mention the skill")
    print("Skill is valid!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
