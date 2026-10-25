"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ComposerProps {
  agentName: string;
  disabled: boolean;
  onSend: (text: string) => void;
}

export function Composer({ agentName, disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex shrink-0 items-center gap-3 border-t border-border-subtle p-4"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`Ask ${agentName}`}
        disabled={disabled}
        aria-label={`Ask ${agentName}`}
        className="h-11 flex-1 rounded-pill border-border-default bg-white/4 px-4 text-sm"
      />
      <Button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        className="h-11 shrink-0 gap-1.5 rounded-pill bg-neutral-50 px-5 text-sm font-medium text-text-inverse hover:bg-white"
      >
        Send
        <Send className="size-3.5" aria-hidden />
      </Button>
    </form>
  );
}
