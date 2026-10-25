"""The agent spec: what a builder's YAML file parses into.

Shape is frozen by the ticket that defined it (see issue #10, Agent spec).
The runtime only ever sees this parsed form.
"""

from typing import Literal

from pydantic import BaseModel, Field

ACCEPTED_MODEL: Literal["gemini/gemini-3.8-flash"] = "gemini/gemini-3.8-flash"


class ConnectorSpec(BaseModel):
    name: str
    allow_list: list[str] | None = None
    side_effect_tools: list[str] = Field(default_factory=list)


class BudgetSpec(BaseModel):
    monthly_cap: float
    warning_fraction: float = 0.8


class EvalsSpec(BaseModel):
    min_score: float


class GuardrailsSpec(BaseModel):
    require_citation: bool = True
    strip_secrets: bool = True


class AgentSpec(BaseModel):
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
