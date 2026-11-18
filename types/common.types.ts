export type ActionResultShape<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: Record<string, string[]> } };

export type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

export type PaginatedResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ModuleStatus = "ready" | "planned";
