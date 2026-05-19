"""LOCO-Agent adapter layer."""

from loco.adapters.base import BaseAdapter
from loco.adapters.vanilla import VanillaAdapter

__all__ = ["BaseAdapter", "VanillaAdapter"]

# Framework adapters — import individually to avoid hard dependencies:
#   from loco.adapters.anthropic import AnthropicAdapter
#   from loco.adapters.openai import OpenAIAdapter
