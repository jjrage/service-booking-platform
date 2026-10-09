import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Database errors the app reacts to, by SQLSTATE (see the commands migration). Anything else is unexpected
 * and is rethrown as is.
 */
export type CommandErrorCode =
  | "slot_taken" //       23P01: no crew is free (lost a race, or an overlap)
  | "hold_expired" //     BK001: the held slot expired before checkout finished
  | "invalid_status" //   BK002: the booking's status does not allow this
  | "forbidden" //        42501: the actor may not do this
  | "not_found" //        P0002
  | "invalid_input"; //   22023

const codes: Record<string, CommandErrorCode> = {
  "23P01": "slot_taken",
  BK001: "hold_expired",
  BK002: "invalid_status",
  "42501": "forbidden",
  P0002: "not_found",
  "22023": "invalid_input",
};

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export function toCommandError(error: PostgrestError): CommandError | null {
  const code = codes[error.code];
  return code ? new CommandError(code, error.message) : null;
}

/** Unwraps a Supabase result: known command errors become CommandError, anything else is thrown as is. */
export function unwrap<T>(
  result: { data: T; error: PostgrestError | null },
  what: string,
): NonNullable<T> {
  if (result.error) {
    throw (
      toCommandError(result.error) ??
      new Error(`${what}: ${result.error.message} (${result.error.code})`)
    );
  }
  if (result.data === null || result.data === undefined) {
    throw new Error(`${what}: no data returned`);
  }
  return result.data;
}

/** For commands that return nothing: throws on error, like unwrap(). */
export function ensureOk(
  result: { error: PostgrestError | null },
  what: string,
): void {
  if (result.error) {
    throw (
      toCommandError(result.error) ??
      new Error(`${what}: ${result.error.message} (${result.error.code})`)
    );
  }
}
