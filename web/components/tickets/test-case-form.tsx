"use client";

/**
 * The save-as-test-case form under a ticket row. The question comes from
 * the ticket; the person says what a good answer must contain, whether it
 * must cite a source, and an optional rubric (`SaveAsTestCaseRequest`).
 */

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SaveAsTestCaseRequest } from "@/lib/contracts/tickets";

export function TestCaseForm({
  question,
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  question: string;
  saving: boolean;
  /** Set when the last save failed; the form keeps what was typed. */
  error: string | null;
  onSubmit: (body: SaveAsTestCaseRequest) => void;
  onCancel: () => void;
}) {
  const [expected, setExpected] = useState("");
  const [citation, setCitation] = useState(true);
  const [rubric, setRubric] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      expected_strings: expected
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      citation_required: citation,
      rubric: rubric.trim() || null,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Save as test case"
      className="flex flex-col gap-4 rounded-lg border border-border-default bg-white/4 p-4"
    >
      <p className="text-sm text-text-secondary">
        Future deploys will be tested with: <span className="text-text-primary">{question}</span>
      </p>

      <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
        Answer must contain (one per line)
        <Textarea
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="21.4%"
          rows={2}
          className="text-text-primary"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
        Rubric (optional)
        <Input
          value={rubric}
          onChange={(e) => setRubric(e.target.value)}
          placeholder="States the margin for the right fiscal year"
          className="text-text-primary"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={citation}
          onChange={(e) => setCitation(e.target.checked)}
          className="size-4 accent-primary-500"
        />
        Answer must cite a source
      </label>

      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving} className="rounded-pill px-4">
          {saving ? "Saving…" : "Save test case"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onCancel}
          className="rounded-pill px-3"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
