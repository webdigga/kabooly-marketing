import type { Context } from "hono";
import type { z } from "zod";

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

// Parses a JSON body against a schema. A malformed body and a failed schema
// both answer 400 naming the first offending field.
export async function parseJson<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<Parsed<z.infer<T>>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "Invalid JSON body" }, 400) };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const field = result.error.issues.map((issue) => issue.path.join(".")).at(0);
    return { ok: false, response: c.json({ error: "Invalid request", field }, 400) };
  }
  return { ok: true, data: result.data };
}
