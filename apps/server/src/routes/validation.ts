import type { ValidationIssue } from "@phone-party/protocol";
import type { Context } from "hono";

export type ZodIssuesLike = {
  readonly issues: readonly {
    readonly path: readonly PropertyKey[];
    readonly message: string;
  }[];
};

export function formatZodIssues(error: ZodIssuesLike): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "(root)" : issue.path.join("."),
    message: issue.message,
  }));
}

export function invalidRequestResponse(c: Context, error: ZodIssuesLike) {
  return c.json(
    {
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request",
        details: formatZodIssues(error),
      },
    },
    400,
  );
}
