"""Recorder: writes run steps (the usage ledger) and keeps each run's cost total current.

The single writer of run_steps. A step's cost is rounded to six places and
added to its run's cost_total in the same transaction, under a lock on the
run row, so the total always equals the sum of the run's step costs.
Functions flush; callers commit.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import Run, RunStep
from hack_tx_2026.models.records import StepKind

MONEY_QUANTUM = Decimal("0.000001")


def money(value: Decimal) -> Decimal:
    """Round to the six decimal places every money column stores."""
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def record_step(
    session: Session,
    run_id: str,
    *,
    kind: StepKind,
    name: str,
    input: dict[str, Any] | None = None,
    output: dict[str, Any] | None = None,
    input_tokens: int | None = None,
    cached_input_tokens: int | None = None,
    output_tokens: int | None = None,
    cost: Decimal | None = None,
    latency_ms: int | None = None,
    error: str | None = None,
) -> RunStep:
    """Append a step to the run and add its cost to the run's total.

    Raises LookupError if the run does not exist.
    """
    run = session.scalar(select(Run).where(Run.id == run_id).with_for_update())
    if run is None:
        raise LookupError(f"run {run_id} not found")
    last = session.scalar(select(func.max(RunStep.sequence)).where(RunStep.run_id == run_id))
    step = RunStep(
        run_id=run_id,
        sequence=(last or 0) + 1,
        kind=kind,
        name=name,
        input=input,
        output=output,
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        output_tokens=output_tokens,
        cost=None if cost is None else money(cost),
        latency_ms=latency_ms,
        error=error,
    )
    session.add(step)
    if step.cost is not None:
        run.cost_total = run.cost_total + step.cost
    session.flush()
    return step
