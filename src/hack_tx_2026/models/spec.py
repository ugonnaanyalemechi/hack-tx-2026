"""The agent spec: what a builder's YAML file parses into.

Shape is frozen by the ticket that defined it (see issue #10, Agent spec).
The runtime only ever sees this parsed form.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

ACCEPTED_MODEL: Literal["gemini/gemini-3.8-flash"] = "gemini/gemini-3.8-flash"


class _SpecSection(BaseModel):
    """Rejects unknown keys and infinite or NaN numbers, so they are errors, not ignored."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ConnectorSpec(_SpecSection):
    name: str
    allow_list: list[str] | None = None
    side_effect_tools: list[str] = Field(default_factory=list)

    @field_validator("side_effect_tools")
    @classmethod
    def _side_effects_are_allowed(cls, tools: list[str], info: ValidationInfo) -> list[str]:
        allow_list = info.data.get("allow_list")
        if allow_list is None:
            return tools
        missing = [t for t in tools if t not in allow_list]
        if missing:
            raise PydanticCustomError(
                "side_effect_not_allowed",
                "side_effect_tools must also be in allow_list; missing: {missing}",
                {"missing": ", ".join(missing)},
            )
        return tools


class BudgetSpec(_SpecSection):
    monthly_cap: float = Field(gt=0)
    warning_fraction: float = Field(default=0.8, gt=0, le=1)


class EvalsSpec(_SpecSection):
    min_score: float = Field(ge=0, le=1)


class GuardrailsSpec(_SpecSection):
    require_citation: bool = True
    strip_secrets: bool = True


class AgentSpec(_SpecSection):
    spec_version: Literal[1] = 1
    name: str
    slug: str
    description: str = ""
    model: Literal["gemini/gemini-3.8-flash"] = ACCEPTED_MODEL
    instructions: str
    connectors: list[ConnectorSpec] = Field(default_factory=list)
    budget: BudgetSpec
    evals: EvalsSpec
    guardrails: GuardrailsSpec = Field(default_factory=GuardrailsSpec)
    trigger: None = None  # reserved, must be empty
