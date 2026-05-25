export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type JsonArray = readonly JsonValue[];

const validateJson = (value: unknown): value is JsonValue => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(validateJson);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every(validateJson);
  }

  return false;
};

export type AssertJsonContext = {
  readonly id: string;
  readonly for: 'arguments' | 'payload' | 'result';
};

export function assertJson(
  value: unknown,
  context: AssertJsonContext,
): asserts value is JsonValue {
  if (__DEV__) {
    if (!validateJson(value)) {
      throw new Error(`Invalid JSON value for ${context.for} of "${context.id}"`);
    }
  }
}
