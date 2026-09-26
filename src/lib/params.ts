// Request-body validation that answers in the same pydantic-shaped `details`
// the Python/Elixir stacks return, because Plugin.Onepager renders them verbatim.

export interface Spec {
  field: string;
  optional?: boolean;
  strip?: boolean;
  min?: number;
  max?: number;
  type?: "string" | "boolean";
  shape?: readonly [(v: string) => boolean, string];
}
export interface Detail {
  type: string;
  loc: string[];
  msg: string;
}
export type Validated =
  | { ok: true; values: Record<string, any> }
  | { ok: false; details: Detail[] };

const TRUTHY = ["1", "on", "t", "true", "y", "yes"];
const FALSY = ["0", "off", "f", "false", "n", "no"];

const detail = (field: string, type: string, msg: string): Detail => ({ type, loc: [field], msg });
const chars = (n: number) => (n === 1 ? "1 character" : `${n} characters`);

function boolean(raw: unknown, field: string): { value: boolean } | Detail {
  if (typeof raw === "boolean") return { value: raw };
  const unparseable = detail(field, "bool_parsing", "Input should be a valid boolean, unable to interpret input");
  if (typeof raw === "string") {
    const word = raw.toLowerCase();
    if (TRUTHY.includes(word)) return { value: true };
    if (FALSY.includes(word)) return { value: false };
    return unparseable;
  }
  if (typeof raw === "number") {
    if (raw === 0) return { value: false };
    if (raw === 1) return { value: true };
    return Number.isInteger(raw) ? unparseable : detail(field, "bool_type", "Input should be a valid boolean");
  }
  return detail(field, "bool_type", "Input should be a valid boolean");
}

function string(raw: unknown, spec: Spec): { value: string } | Detail {
  const { field } = spec;
  if (typeof raw !== "string") return detail(field, "string_type", "Input should be a valid string");
  const value = spec.strip ? raw.trim() : raw;
  const length = [...value].length;
  if (spec.min !== undefined && length < spec.min)
    return detail(field, "string_too_short", `String should have at least ${chars(spec.min)}`);
  if (spec.max !== undefined && length > spec.max)
    return detail(field, "string_too_long", `String should have at most ${chars(spec.max)}`);
  if (spec.shape && !spec.shape[0](value)) return detail(field, "value_error", `Value error, ${spec.shape[1]}`);
  return { value };
}

export function validate(params: Record<string, unknown>, specs: readonly Spec[]): Validated {
  const values: Record<string, any> = {};
  const details: Detail[] = [];
  for (const spec of specs) {
    const present = Object.prototype.hasOwnProperty.call(params, spec.field);
    const raw = params[spec.field];
    if (!present || raw === null || raw === undefined) {
      if (spec.optional) values[spec.field] = null;
      else details.push(detail(spec.field, "missing", "Field required"));
      continue;
    }
    const result = spec.type === "boolean" ? boolean(raw, spec.field) : string(raw, spec);
    if ("value" in result) values[spec.field] = result.value;
    else details.push(result);
  }
  return details.length ? { ok: false, details } : { ok: true, values };
}
