"use client";

import { useState, useTransition } from "react";

import { Button } from "@/ui/button";
import { Textarea } from "@/ui/form";

import { addNoteAction } from "../../actions";

export function NoteForm({ clientId }: { clientId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await addNoteAction(clientId, body);
          if (result.ok) setBody("");
          setError(result.ok ? null : result.message);
        });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note for the team"
        aria-label="New note"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" size="sm" disabled={pending || body.trim().length === 0}>
        Add note
      </Button>
    </form>
  );
}
