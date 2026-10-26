import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/** Minimal react-hook-form resolver for Zod 4 schemas. */
export function zodResolver<T extends FieldValues>(schema: z.ZodType<T>): Resolver<T> {
  return async (values) => {
    const r = await schema.safeParseAsync(values);
    if (r.success) return { values: r.data, errors: {} };
    const errors: Record<string, unknown> = {};
    for (const issue of r.error.issues) {
      const path = issue.path.map(String);
      if (getIn(errors, path.length ? path : ["root"])) continue;
      setIn(errors, path.length ? path : ["root"], { type: issue.code, message: issue.message });
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}

function getIn(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setIn(obj: Record<string, unknown>, path: string[], value: unknown) {
  let cur = obj;
  path.forEach((k, i) => {
    if (i === path.length - 1) cur[k] = value;
    else {
      if (typeof cur[k] !== "object" || cur[k] == null) cur[k] = /^\d+$/.test(path[i + 1]!) ? [] : {};
      cur = cur[k] as Record<string, unknown>;
    }
  });
}
