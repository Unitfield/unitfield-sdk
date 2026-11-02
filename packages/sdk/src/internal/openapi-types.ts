/** Helpers that pull request and response types out of a generated openapi-typescript `paths` interface. */

type Json = "application/json";

/** The JSON body of the first documented 2xx response of an operation. */
export type ResponseJson<Operation> = Operation extends { responses: infer Responses }
  ? {
      [Status in keyof Responses & (200 | 201 | 202)]: Responses[Status] extends { content: { [K in Json]: infer Body } } ? Body : undefined;
    }[keyof Responses & (200 | 201 | 202)]
  : never;

export type RequestJson<Operation> = Operation extends { requestBody: { content: { [K in Json]: infer Body } } }
  ? Body
  : Operation extends { requestBody?: { content: { [K in Json]: infer Body } } }
    ? Body
    : never;

export type QueryOf<Operation> = Operation extends { parameters: { query?: infer Query } } ? NonNullable<Query> : never;

/** `paths[Path][Method]` of a generated document. */
export type Op<Paths, Path extends keyof Paths, Method extends keyof Paths[Path]> = Paths[Path][Method];

/**
 * The OpenAPI documents type every int and double as `number | string`, because the API also accepts numbers written
 * as digit strings. Responses always carry JSON numbers. `Wire<T>` narrows a generated response (or query) shape to
 * what actually travels: any property whose type holds both `number` and `string` keeps only `number`, recursively.
 * Properties that are only `string` are left alone.
 */
export type Wire<T> = [Extract<T, number>] extends [never] ? WireStructure<T> : WireStructure<Exclude<T, string>>;

type WireStructure<T> = T extends readonly (infer Item)[] ? Wire<Item>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
