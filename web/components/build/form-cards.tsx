"use client";

import { Loader2 } from "lucide-react";
import { Field } from "@/components/build/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { slugify } from "@/lib/agent-yaml";
import type { BuildConnector, BuildForm, FormErrors } from "@/lib/build-form";

type Patch = (patch: Partial<BuildForm>) => void;

export function BasicsCard({
  form,
  errors,
  patch,
}: {
  form: BuildForm;
  errors: FormErrors;
  patch: Patch;
}) {
  const slug = slugify(form.name);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Basics</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field
          id="agent-name"
          label="Name"
          error={errors.name}
          hint={
            slug ? (
              <>
                Becomes the chat page link: <span className="font-mono">/agents/{slug}</span>
              </>
            ) : (
              "Becomes the chat page link once you type a name."
            )
          }
        >
          <Input
            id="agent-name"
            value={form.name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "agent-name-error" : "agent-name-hint"}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field id="agent-description" label="Description">
          <Input
            id="agent-description"
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
        <Field id="agent-instructions" label="Instructions" error={errors.instructions}>
          <Textarea
            id="agent-instructions"
            rows={4}
            value={form.instructions}
            aria-invalid={errors.instructions ? true : undefined}
            aria-describedby={errors.instructions ? "agent-instructions-error" : undefined}
            onChange={(e) => patch({ instructions: e.target.value })}
          />
        </Field>
        <Field
          id="agent-model"
          label="Model"
          hint="The only model available in this release."
        >
          <Input id="agent-model" value="muse-spark-1.3" readOnly disabled />
        </Field>
      </CardContent>
    </Card>
  );
}

const STATUS = {
  approved: { tone: "success", label: "Approved" },
  waiting: { tone: "warning", label: "Waiting for admin" },
} as const;

export function ConnectorsCard({
  form,
  connectors,
  requesting,
  patch,
  onRequest,
}: {
  form: BuildForm;
  connectors: BuildConnector[];
  requesting: string | null;
  patch: Patch;
  onRequest: (connectorId: string) => void;
}) {
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...form.connectors, id] : form.connectors.filter((c) => c !== id);
    // Drop side-effect marks for tools of a connector that was unchecked.
    const keep = new Set(
      connectors.filter((c) => next.includes(c.id)).flatMap((c) => c.tools)
    );
    patch({
      connectors: next,
      sideEffectTools: form.sideEffectTools.filter((t) => keep.has(t)),
    });
  };
  const approvedChosen = connectors.filter(
    (c) => c.status === "approved" && form.connectors.includes(c.id)
  );

  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle>Connectors</CardTitle>
        <span className="text-xs text-text-muted">Approved by an admin</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul aria-label="Connectors" className="flex flex-col divide-y divide-border-default">
          {connectors.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-3">
                <Checkbox
                  id={`connector-${c.id}`}
                  checked={form.connectors.includes(c.id)}
                  onCheckedChange={(on) => toggle(c.id, on === true)}
                />
                <Label htmlFor={`connector-${c.id}`}>{c.label}</Label>
              </div>
              {c.status === "none" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={requesting === c.id}
                  aria-label={`Request approval for ${c.label}`}
                  onClick={() => onRequest(c.id)}
                >
                  {requesting === c.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Request approval
                </Button>
              ) : (
                <StatusBadge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusBadge>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          Tools that change something outside the chat will ask the user to approve each time. Mark
          them once a connector is approved.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-text-secondary">
            Mark side-effect tools
          </legend>
          {approvedChosen.length === 0 ? (
            <p className="text-xs text-text-muted">
              Check an approved connector to see its tools.
            </p>
          ) : (
            approvedChosen.flatMap((c) =>
              c.tools.map((tool) => (
                <div key={`${c.id}-${tool}`} className="flex items-center gap-3">
                  <Checkbox
                    id={`tool-${tool}`}
                    checked={form.sideEffectTools.includes(tool)}
                    onCheckedChange={(on) =>
                      patch({
                        sideEffectTools:
                          on === true
                            ? [...form.sideEffectTools, tool]
                            : form.sideEffectTools.filter((t) => t !== tool),
                      })
                    }
                  />
                  <Label htmlFor={`tool-${tool}`} className="font-mono text-xs">
                    {tool}
                  </Label>
                  <span className="text-xs text-text-muted">{c.label}</span>
                </div>
              ))
            )
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}

export function LimitsCard({
  form,
  errors,
  patch,
}: {
  form: BuildForm;
  errors: FormErrors;
  patch: Patch;
}) {
  const num = (id: string, label: string, key: "monthlyUsd" | "warnAt" | "minScore", step: string) => (
    <Field id={id} label={label} error={errors[key]}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={form[key]}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${id}-error` : undefined}
        onChange={(e) => patch({ [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget, evals and guardrails</CardTitle>
        <CardDescription>
          Warn at 80% and the agent pauses or moves to a cheaper model at the cap.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {num("limit-monthly", "Monthly USD", "monthlyUsd", "1")}
          {num("limit-warn", "Warn at", "warnAt", "0.05")}
          <Field id="limit-on-cap" label="On cap">
            <Select
              id="limit-on-cap"
              value={form.onCap}
              onChange={(e) => patch({ onCap: e.target.value as BuildForm["onCap"] })}
            >
              <option value="pause">Pause</option>
              <option value="downgrade">Downgrade</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {num("eval-min-score", "Eval min score", "minScore", "0.05")}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-text-secondary">Guardrails</legend>
          <div className="flex items-center gap-3">
            <Checkbox
              id="guard-citation"
              checked={form.requireCitation}
              onCheckedChange={(on) => patch({ requireCitation: on === true })}
            />
            <Label htmlFor="guard-citation">Require citation</Label>
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id="guard-secrets"
              checked={form.stripSecrets}
              onCheckedChange={(on) => patch({ stripSecrets: on === true })}
            />
            <Label htmlFor="guard-secrets">Strip secrets</Label>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
