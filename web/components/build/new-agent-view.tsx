"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { BasicsCard, ConnectorsCard, LimitsCard } from "@/components/build/form-cards";
import { Field } from "@/components/build/field";
import { YamlPanel, type SaveState } from "@/components/build/yaml-panel";
import { ErrorState } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import {
  EMPTY_FORM,
  formToYaml,
  validateForm,
  type BuildConnector,
  type BuildForm,
  type FormErrors,
} from "@/lib/build-form";
import { useIdentity } from "@/lib/identity";
import { useApiQuery } from "@/lib/use-api-query";

/** The new-agent form: setup assistant, three cards, and the live agent file beside them. */
export function NewAgentView() {
  const { api, currentUser } = useIdentity();
  const connectorQuery = useApiQuery("build-connectors", (client) => client.listBuildConnectors());

  const [form, setForm] = useState<BuildForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [prompt, setPrompt] = useState("");
  const [assistant, setAssistant] = useState<
    { status: "idle" | "working" } | { status: "error"; message: string }
  >({ status: "idle" });
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  // Connector status changes made on this page (Request approval).
  const [overrides, setOverrides] = useState<Record<string, BuildConnector>>({});
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const connectors = useMemo(
    () =>
      connectorQuery.status === "ready"
        ? connectorQuery.data.map((c) => overrides[c.id] ?? c)
        : [],
    [connectorQuery, overrides]
  );

  const patch = (change: Partial<BuildForm>) => {
    setForm((f) => ({ ...f, ...change }));
    // A field stops showing its error as soon as it is edited.
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(change) as (keyof BuildForm)[]) delete next[key];
      return next;
    });
    setSave((s) => (s.status === "saved" ? s : { status: "idle" }));
  };

  const yaml = formToYaml(form, connectors, currentUser?.id ?? "me");

  // RUNTIME-PLACEHOLDER(#15): canned, keyword-matched answer after a fake delay;
  // replaced by api.suggestAgentForm backed by a metered model call.
  async function fillForm() {
    if (!api) return;
    setAssistant({ status: "working" });
    try {
      const suggestion = await api.suggestAgentForm(prompt);
      patch(suggestion);
      setAssistant({ status: "idle" });
    } catch (error) {
      setAssistant({
        status: "error",
        message: error instanceof Error ? error.message : "Couldn't fill in the form.",
      });
    }
  }

  async function requestApproval(connectorId: string) {
    if (!api) return;
    setRequesting(connectorId);
    setRequestError(null);
    try {
      const updated = await api.requestConnectorApproval(connectorId);
      setOverrides((o) => ({ ...o, [connectorId]: updated }));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Couldn't send the request.");
    } finally {
      setRequesting(null);
    }
  }

  /** Field errors from the form, shown beside each field. False if any. */
  function checkFields(): boolean {
    const found = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length === 0) return true;
    setSave({
      status: "invalid",
      errors: Object.entries(found).map(([field, message]) => ({
        field: field === "monthlyUsd" ? "monthly_usd" : field === "warnAt" ? "warn_at" : field === "minScore" ? "evals.min_score" : field,
        message: message ?? "",
      })),
    });
    return false;
  }

  async function validate() {
    if (!api || !checkFields()) return;
    setSave({ status: "validating" });
    try {
      const result = await api.validateAgentSpec(yaml);
      setSave(result.valid ? { status: "valid" } : { status: "invalid", errors: result.errors });
    } catch (error) {
      setSave({ status: "error", message: errorMessage(error) });
    }
  }

  async function saveDraft() {
    if (!api || !checkFields()) return;
    setSave({ status: "saving" });
    try {
      const agent = await api.createAgent(yaml);
      setSave({ status: "saved", agentId: agent.id, name: agent.name });
    } catch (error) {
      setSave({ status: "error", message: errorMessage(error) });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Setup assistant</CardTitle>
          <CardDescription>
            One sentence is enough. The form below is filled in for you to review.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <div className="flex w-full flex-col gap-1.5">
            <Field id="assistant-prompt" label="What should the agent do?">
              <Textarea
                id="assistant-prompt"
                rows={2}
                value={prompt}
                placeholder="Check marketing copy against our compliance wording rules and list every line that breaks one."
                onChange={(e) => setPrompt(e.target.value)}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={assistant.status === "working" || prompt.trim() === ""}
            onClick={fillForm}
          >
            {assistant.status === "working" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Filling in the form…
              </>
            ) : (
              "Fill in the form"
            )}
          </Button>
          {assistant.status === "error" ? (
            <ErrorState title="The setup assistant isn't available." message={assistant.message} />
          ) : null}
        </CardContent>
      </Card>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex flex-col gap-6">
          <BasicsCard form={form} errors={errors} patch={patch} />
          {connectorQuery.status === "loading" ? (
            <Skeleton aria-label="Loading connectors" className="h-64 rounded-xl" />
          ) : connectorQuery.status === "error" ? (
            <ErrorState
              title="Couldn't load connectors."
              message={connectorQuery.error.message}
              onRetry={connectorQuery.retry}
            />
          ) : (
            <>
              <ConnectorsCard
                form={form}
                connectors={connectors}
                requesting={requesting}
                patch={patch}
                onRequest={requestApproval}
              />
              {requestError ? (
                <ErrorState title="Couldn't request approval." message={requestError} />
              ) : null}
            </>
          )}
          <LimitsCard form={form} errors={errors} patch={patch} />
        </div>
        <YamlPanel yaml={yaml} state={save} onValidate={validate} onSave={saveDraft} />
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}
