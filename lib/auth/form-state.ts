export type AuthFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const INITIAL_AUTH_STATE: AuthFormState = { status: "idle" };
