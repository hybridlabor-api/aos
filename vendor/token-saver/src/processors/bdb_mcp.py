"""Specialized Processors for BDB Creative & Media MCP Tools."""

import json
import re
from typing import Any

from src.processors.base import Processor


class BdbTouchdesignerProcessor(Processor):
    """Processor for BDB TouchDesigner MCP outputs (bdb_td_* / mcp_td_*)."""

    priority = 9
    name = "bdb_touchdesigner"
    hook_patterns = [r"bdb_td_\w+", r"get_td_\w+", r"mcp_td_\w+"]

    def can_handle(self, command: str) -> bool:
        return any(
            kw in command.lower()
            for kw in [
                "bdb_td",
                "touchdesigner",
                "get_td_nodes",
                "get_td_node_parameters",
                "mcp_td",
            ]
        )

    def process(self, command: str, output: str) -> str:
        output_str = output.strip()
        if not output_str:
            return output_str

        # Try parsing JSON responses
        try:
            data = json.loads(output_str)
            compressed_data = self._compress_td_json(data)
            return json.dumps(compressed_data, separators=(",", ":"))
        except Exception:
            # Line-based log compression for TD cook errors
            lines = output_str.splitlines()
            result = []
            for line in lines:
                if any(
                    err_kw in line.lower()
                    for err_kw in ["error", "warning", "cook", "fail", "exception"]
                ) or line.startswith(("/", "op:", "COMP:", "TOP:", "CHOP:", "DAT:")):
                    result.append(line)
            return "\n".join(result) if result else output_str[:400]

    def _compress_td_json(self, data: Any) -> Any:
        if isinstance(data, list):
            return [self._compress_td_json(item) for item in data if item is not None]
        if isinstance(data, dict):
            compressed = {}
            for k, v in data.items():
                # Always preserve critical keys
                if k in (
                    "name",
                    "path",
                    "type",
                    "error",
                    "errors",
                    "cook_error",
                    "val",
                    "value",
                    "id",
                ):
                    compressed[k] = self._compress_td_json(v)
                elif isinstance(v, (dict, list)):
                    sub = self._compress_td_json(v)
                    if sub:
                        compressed[k] = sub
                # Filter out default zero/null/empty/false properties
                elif v not in (0, 0.0, "", None, False, [], {}):
                    compressed[k] = v
            return compressed
        return data


class BdbUnrealProcessor(Processor):
    """Processor for BDB Unreal Engine MCP outputs (bdb_unreal_* / mcp_unreal_*)."""

    priority = 10
    name = "bdb_unreal"
    hook_patterns = [r"bdb_unreal_\w+", r"unreal_\w+", r"mcp_unreal_\w+"]

    def can_handle(self, command: str) -> bool:
        return any(
            kw in command.lower()
            for kw in ["unreal", "bdb_unreal", "control_actor", "manage_blueprint"]
        )

    def process(self, command: str, output: str) -> str:
        output_str = output.strip()
        if not output_str:
            return output_str

        try:
            data = json.loads(output_str)
            compressed_data = self._compress_unreal_json(data)
            return json.dumps(compressed_data, separators=(",", ":"))
        except Exception:
            lines = output_str.splitlines()
            result = [
                l
                for l in lines
                if any(
                    k in l.lower()
                    for k in ["error", "warning", "pcg", "blueprint", "actor", "logunreal"]
                )
            ]
            return "\n".join(result) if result else output_str[:500]

    def _compress_unreal_json(self, data: Any) -> Any:
        if isinstance(data, list):
            return [self._compress_unreal_json(i) for i in data if i is not None]
        if isinstance(data, dict):
            compressed = {}
            for k, v in data.items():
                if k in (
                    "name",
                    "actor",
                    "class",
                    "location",
                    "rotation",
                    "scale",
                    "error",
                    "status",
                    "id",
                ):
                    compressed[k] = self._compress_unreal_json(v)
                elif isinstance(v, (dict, list)):
                    sub = self._compress_unreal_json(v)
                    if sub:
                        compressed[k] = sub
                elif v not in (None, "", [], {}):
                    compressed[k] = v
            return compressed
        return data


class BdbAfterEffectsProcessor(Processor):
    """Processor for BDB After Effects MCP outputs (bdb_after_effects_* / ae-mcp)."""

    priority = 11
    name = "bdb_after_effects"
    hook_patterns = [r"bdb_after_effects_\w+", r"ae-mcp", r"after_effects_\w+"]

    def can_handle(self, command: str) -> bool:
        return any(
            kw in command.lower()
            for kw in ["after_effects", "ae-mcp", "extendscript", "create-composition"]
        )

    def process(self, command: str, output: str) -> str:
        output_str = output.strip()
        if not output_str:
            return output_str

        try:
            data = json.loads(output_str)
            return json.dumps(self._clean_ae_json(data), separators=(",", ":"))
        except Exception:
            lines = output_str.splitlines()
            filtered = [
                l
                for l in lines
                if not re.search(r"Rendering frame \d+|Progress: \d+%", l)
                and any(
                    k in l.lower() for k in ["error", "layer", "comp", "effect", "render", "result"]
                )
            ]
            return "\n".join(filtered) if filtered else output_str[:400]

    def _clean_ae_json(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {
                k: self._clean_ae_json(v)
                for k, v in data.items()
                if k in ("name", "index", "layer", "comp", "error", "effects", "status")
                or (v not in (None, "", []))
            }
        elif isinstance(data, list):
            return [self._clean_ae_json(i) for i in data if i is not None]
        return data


class BdbDavinciProcessor(Processor):
    """Processor for BDB DaVinci Resolve MCP outputs (bdb_davinci_* / resolve_mcp)."""

    priority = 12
    name = "bdb_davinci"
    hook_patterns = [r"bdb_davinci_\w+", r"resolve_mcp\w*"]

    def can_handle(self, command: str) -> bool:
        return any(kw in command.lower() for kw in ["davinci", "resolve", "mediapool", "timeline"])

    def process(self, command: str, output: str) -> str:
        output_str = output.strip()
        if not output_str:
            return output_str

        try:
            data = json.loads(output_str)
            return json.dumps(self._clean_davinci_json(data), separators=(",", ":"))
        except Exception:
            lines = output_str.splitlines()
            return "\n".join(
                [
                    l
                    for l in lines
                    if any(k in l.lower() for k in ["error", "clip", "timeline", "track", "render"])
                ]
            )

    def _clean_davinci_json(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {
                k: self._clean_davinci_json(v)
                for k, v in data.items()
                if k in ("name", "clip", "track", "start", "end", "error", "status", "id")
                or (v not in (None, "", []))
            }
        elif isinstance(data, list):
            return [self._clean_davinci_json(i) for i in data if i is not None]
        return data


class BdbCreativeSuiteProcessor(Processor):
    """Processor for Resolume, Rhino 3D, and Adobe UXP Plugin outputs."""

    priority = 13
    name = "bdb_creative_suite"
    hook_patterns = [r"bdb_resolume_\w+", r"bdb_rhino_\w+", r"adobe_uxp_\w+"]

    def can_handle(self, command: str) -> bool:
        return any(
            kw in command.lower()
            for kw in ["resolume", "rhino", "adobe_uxp", "photoshop", "premiere"]
        )

    def process(self, command: str, output: str) -> str:
        output_str = output.strip()
        if not output_str:
            return output_str

        try:
            data = json.loads(output_str)
            return json.dumps(data, separators=(",", ":"))
        except Exception:
            return "\n".join(
                [
                    l
                    for l in output_str.splitlines()
                    if any(k in l.lower() for k in ["error", "layer", "clip", "geom", "status"])
                ]
            )


class BdbMembProcessor(Processor):
    """Processor for BDB memB Semantic Memory outputs (memb_mcp / memb-skill)."""

    priority = 14
    name = "bdb_memb"
    hook_patterns = [r"memb_\w+", r"search_memory", r"add_memory"]

    def can_handle(self, command: str) -> bool:
        return any(
            kw in command.lower() for kw in ["memb", "add_memory", "search_memory", "godmode"]
        )

    def process(self, command: str, output: str) -> str:
        output_str = output.strip()
        if not output_str:
            return output_str

        try:
            data = json.loads(output_str)
            if isinstance(data, list):
                compressed = []
                for item in data:
                    if isinstance(item, dict):
                        compressed.append(
                            {
                                "id": item.get("id"),
                                "category": item.get("category"),
                                "project_id": item.get("project_id"),
                                "text": item.get("text", item.get("content", "")),
                            }
                        )
                return json.dumps(compressed, separators=(",", ":"))
            return json.dumps(data, separators=(",", ":"))
        except Exception:
            return output_str
