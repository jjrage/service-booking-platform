/**
 * The generated RPC types mark every SQL parameter without a default as non-null, but the functions take
 * null where it means something (a guest has no user id). This passes null through those signatures.
 */
export function nullable<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}
