/**
 * Shared API pieces. Mirrors `ErrorBody` / `ErrorResponse` in
 * `src/hack_tx_2026/models/api.py`: every error response has this shape.
 */

export interface ErrorBody {
  /** snake_case, e.g. "agent_not_found", "override_reason_required". */
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface ErrorResponse {
  error: ErrorBody;
}
