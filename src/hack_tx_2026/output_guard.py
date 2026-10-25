"""Output guard: the last check on an answer before the user sees it.

`guard_text` is a plain function over the final text and the agent's
guardrails, so chat (`_respond_node`), the non-streaming invoke and evals all
call it the same way. It does no I/O; the caller records the step and streams
the notes.

- strip_secrets: anything that looks like a credential is replaced with
  `[redacted]` (see `SECRET_PATTERNS`).
- require_citation: the answer must contain a citation (see `has_citation`).
  Without one the whole answer is replaced by `BLOCKED_TEXT`, because the guard
  cannot invent a source.

Secrets are stripped first, so the citation check sees the final text.
"""

import re
from dataclasses import dataclass, field

from hack_tx_2026.models.spec import GuardrailsSpec

REDACTION = "[redacted]"
BLOCKED_TEXT = "I can't share this answer because it does not cite a source."

SECRET_PATTERNS: list[re.Pattern[str]] = [
    # PEM private key blocks.
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),  # AWS access key id
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),  # OpenAI / Anthropic style keys
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b"),  # GitHub tokens
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{30,}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),  # Slack tokens
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),  # Google API key
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),  # JWT
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{16,}"),
]
# "password: hunter2", "api_key = abc123": keep the label, drop the value.
_ASSIGNMENT = re.compile(
    r"(?i)\b((?:[a-z0-9]+[_-])*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)"
    r"(?:[_-][a-z0-9]+)*\s*[:=]\s*)(?!\[redacted\])[^\s,;\"']+"
)

_CITATION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\[\d+\]"),  # [1]
    re.compile(r"(?i)[\[(]\s*sources?\b[^\])]*[\])]"),  # (source: ...), [Source: ...]
    re.compile(r"https?://\S+"),  # a link
]


@dataclass(frozen=True)
class GuardResult:
    text: str  # what the user gets
    notes: list[str] = field(default_factory=list)  # one per change, for the user
    secrets_stripped: int = 0
    blocked: bool = False  # the answer was replaced for lacking a citation

    @property
    def changed(self) -> bool:
        return bool(self.notes)


def find_citations(text: str) -> list[str]:
    """Every citation in the text: `[1]`, `(source: ...)` / `[Source: ...]`, or
    an http(s) link, in pattern order."""
    return [m.group(0) for p in _CITATION_PATTERNS for m in p.finditer(text)]


def has_citation(text: str) -> bool:
    """True for `[1]`, `(source: ...)` / `[Source: ...]`, or an http(s) link."""
    return any(p.search(text) for p in _CITATION_PATTERNS)


def strip_secrets(text: str) -> tuple[str, int]:
    """Returns the text with secrets replaced and how many were replaced."""
    count = 0
    for pattern in SECRET_PATTERNS:
        text, n = pattern.subn(REDACTION, text)
        count += n
    text, n = _ASSIGNMENT.subn(lambda m: m.group(1) + REDACTION, text)
    return text, count + n


def guard_text(text: str, guardrails: GuardrailsSpec) -> GuardResult:
    """Applies the agent's guardrails to a final answer."""
    notes: list[str] = []
    stripped = 0
    if guardrails.strip_secrets:
        text, stripped = strip_secrets(text)
        if stripped:
            notes.append("Secrets were removed from this answer.")
    blocked = guardrails.require_citation and not has_citation(text)
    if blocked:
        text = BLOCKED_TEXT
        notes.append("This answer was blocked because it did not include a citation.")
    return GuardResult(text=text, notes=notes, secrets_stripped=stripped, blocked=blocked)
