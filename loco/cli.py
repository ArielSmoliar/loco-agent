"""LOCO-Agent CLI.

Usage:
    loco doctor    Detect installed agent frameworks and show integration guide
    loco version   Show version
"""

from __future__ import annotations

import importlib.metadata
import subprocess
import sys


# Framework detection: package name -> (display name, adapter import, quick start)
FRAMEWORKS = {
    "anthropic": (
        "Anthropic SDK",
        "loco.adapters.anthropic.AnthropicAdapter",
        'adapter = AnthropicAdapter(scheduler, client=anthropic.AsyncAnthropic())\nresponse = await adapter.create_message("agent", model="claude-sonnet-4-20250514", ...)',
    ),
    "openai": (
        "OpenAI SDK",
        "loco.adapters.openai.OpenAIAdapter",
        'adapter = OpenAIAdapter(scheduler, client=openai.AsyncOpenAI())\nresponse = await adapter.create_chat("agent", model="gpt-4o", messages=[...])',
    ),
    "langchain-core": (
        "LangChain",
        "loco.adapters.langchain.LOCOCallbackHandler",
        'callback = LOCOCallbackHandler(scheduler, agent_id="agent")\nllm = ChatOpenAI(callbacks=[callback])',
    ),
    "google-adk": (
        "Google ADK",
        "loco.adapters.google_adk.ADKAdapter",
        'adapter = ADKAdapter(scheduler)\nagent = adk.Agent(before_model_callback=adapter.before_model, after_model_callback=adapter.after_model)',
    ),
    "crewai": (
        "CrewAI",
        "loco.adapters.crewai.CrewAIAdapter",
        'adapter = CrewAIAdapter(scheduler)\nresult = await adapter.run_crew(crew, task_descriptions=[...])',
    ),
    "boto3": (
        "AWS Bedrock",
        "loco.adapters.aws_bedrock.BedrockAdapter",
        'adapter = BedrockAdapter(scheduler, client=bedrock_client)\nresponse = await adapter.invoke("agent", model_id="anthropic.claude-sonnet-4-20250514-v1:0", body={...})',
    ),
    "autogen-core": (
        "AutoGen",
        "loco.adapters.autogen.AutoGenAdapter",
        'adapter = AutoGenAdapter(scheduler)\nresult = await adapter.send_message("sender", "recipient", "content")',
    ),
}

# Alternative package names that map to the same framework
ALIASES = {
    "langchain": "langchain-core",
    "langchain-community": "langchain-core",
    "autogen-agentchat": "autogen-core",
}


def _get_installed_packages() -> dict[str, str]:
    """Get installed packages and their versions."""
    packages = {}
    for dist in importlib.metadata.distributions():
        name = dist.metadata["Name"]
        version = dist.metadata["Version"]
        if name:
            packages[name.lower()] = version
    return packages


def _doctor() -> None:
    """Detect installed agent frameworks and show integration guide."""
    print("LOCO Doctor")
    print("=" * 60)
    print()

    installed = _get_installed_packages()
    found = []
    not_found = []

    # Check each framework
    for pkg, (name, adapter, _) in FRAMEWORKS.items():
        # Check main package and aliases
        version = installed.get(pkg.lower())
        if not version:
            for alias, target in ALIASES.items():
                if target == pkg and alias.lower() in installed:
                    version = installed[alias.lower()]
                    break

        if version:
            found.append((pkg, name, adapter, version))
        else:
            not_found.append((pkg, name))

    # Display results
    if found:
        print("Detected frameworks:")
        for pkg, name, adapter, version in found:
            print(f"  \033[32m+\033[0m {name:<16} v{version:<12} -> {adapter}")
        print()
    else:
        print("  No agent frameworks detected.")
        print("  Install one: pip install anthropic openai langchain-core google-adk crewai")
        print()
        return

    if not_found:
        print("Not installed:")
        for pkg, name in not_found:
            print(f"  \033[2m- {name:<16} (pip install {pkg})\033[0m")
        print()

    # Quick start for first detected framework
    first_pkg, first_name, _, _ = found[0]
    _, _, quick_start = FRAMEWORKS[first_pkg]
    print("Quick start (%s):" % first_name)
    print()
    print("  import loco")
    print('  loco.configure(capacity=3, optimize_for="balanced")')
    print()
    for line in quick_start.split("\n"):
        print(f"  {line}")
    print()
    print("  # Or use the one-line wrapper:")
    print("  response = await loco.wrap(your_llm_call, agent_id=\"agent\", weight=2.0, ...)")
    print()

    # LOCO version
    try:
        loco_version = importlib.metadata.version("loco-agent")
    except importlib.metadata.PackageNotFoundError:
        from loco import __version__
        loco_version = __version__
    print(f"LOCO-Agent v{loco_version}")
    print(f"Docs: https://github.com/ArielSmoliar/loco-agent")


def _version() -> None:
    """Show version."""
    try:
        version = importlib.metadata.version("loco-agent")
    except importlib.metadata.PackageNotFoundError:
        from loco import __version__
        version = __version__
    print(f"loco-agent {version}")


def main() -> None:
    """CLI entry point."""
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        return

    command = args[0]

    if command == "doctor":
        _doctor()
    elif command == "version":
        _version()
    else:
        print(f"Unknown command: {command}")
        print(__doc__.strip())
        sys.exit(1)


if __name__ == "__main__":
    main()
