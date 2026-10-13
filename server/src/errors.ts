export type ErrorParams = Record<string, string | number>;

/**
 * User-facing error: `error` stays in English for logs and API clients, while
 * `code` (+ `params`) lets the web app show it in the visitor's language.
 */
export interface ErrorBody {
  error: string;
  code: string;
  params?: ErrorParams;
}

export function errorBody(code: string, error: string, params?: ErrorParams): ErrorBody {
  return params ? { error, code, params } : { error, code };
}
