"""Print the tools an agent may call, then verify the workspace audit chain.

Usage:
    KEEL_API_KEY=sk_dev_... KEEL_AGENT_ID=agt_atlas python python/examples/quickstart.py
"""

import os
import sys
from pathlib import Path

# Allow running from a checkout without `pip install -e ./python`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from keel import Keel, build_tool_specs


def main() -> None:
    keel = Keel.from_env()
    agent_id = os.environ["KEEL_AGENT_ID"]

    me = keel.me()
    print(f'{me["organization"]["name"]} / {me["project"]["name"]} / {me["environment"]["type"]}')

    specs = build_tool_specs(keel, agent_id)
    print(f"{len(specs)} governed tools for {agent_id}:")
    for spec in specs:
        resource = f' resource={spec.resource_pattern}' if spec.resource_key else ""
        print(f"  {spec.name:<32} {spec.risk:<11}{resource}")

    check = keel.audit.verify()
    print(f'audit chain valid={check["valid"]} events={check["eventsChecked"]}')


if __name__ == "__main__":
    main()
