import { NextResponse } from "next/server";

// Consistent JSON error shape. Logs the real cause server-side but never leaks
// internal error details (or stack/DSN) to the client.
export function jsonError(message: string, status = 500, cause?: unknown) {
  if (cause) console.error(`[api ${status}] ${message}:`, cause);
  return NextResponse.json({ error: message }, { status });
}
