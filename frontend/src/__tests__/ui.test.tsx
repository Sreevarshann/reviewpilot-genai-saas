import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeverityBar, StatusBadge } from "@/components/Reviews";
import { fmtMs, Meter } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { atLeast } from "@/lib/session";

describe("ui primitives", () => {
  it("renders a usage meter as an accessible progressbar", () => {
    render(<Meter label="Reviews" used={20} limit={25} />);
    const bar = screen.getByRole("progressbar", { name: "Reviews" });
    expect(bar).toHaveAttribute("aria-valuenow", "20");
    expect(bar).toHaveAttribute("aria-valuemax", "25");
    expect(screen.getByText("20 / 25")).toBeInTheDocument();
  });

  it("shows only non-zero severities", () => {
    render(<SeverityBar by={{ HIGH: 1, MEDIUM: 0, LOW: 3 }} />);
    expect(screen.getByText("1 High")).toBeInTheDocument();
    expect(screen.getByText("3 Low")).toBeInTheDocument();
    expect(screen.queryByText(/Medium/)).toBeNull();
  });

  it("labels review status", () => {
    render(<StatusBadge status="FAILED" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("formats durations", () => {
    expect(fmtMs(null)).toBe("—");
    expect(fmtMs(850)).toBe("850 ms");
    expect(fmtMs(42346)).toBe("42.3 s");
  });

  it("orders roles", () => {
    expect(atLeast("ADMIN", "REVIEWER")).toBe(true);
    expect(atLeast("VIEWER", "REVIEWER")).toBe(false);
    expect(atLeast(undefined, "VIEWER")).toBe(false);
  });
});

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the Idempotency-Key and CSRF header, and surfaces API error codes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "plan_limit", message: "The Free plan allows 25 reviews" }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const err = await api.submitReview("acme", { projectId: "p", title: "t", diff: "diff --git a b" }, "draft-0001-0001").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "plan_limit", message: "The Free plan allows 25 reviews" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/orgs/acme/reviews");
    expect(init.headers).toMatchObject({ "Idempotency-Key": "draft-0001-0001", "X-Requested-With": "reviewpilot", "Content-Type": "application/json" });
  });

  it("joins the API's 422 validation messages", async () => {
    // shape returned by the NestJS StandardSchemaValidationPipe (verified against the running API)
    const body = { message: ["password: Use at least 12 characters", "name: Required"], error: "Unprocessable Entity", statusCode: 422 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422, headers: { "content-type": "application/json" } })));
    await expect(api.register({ email: "a@b.test", name: "A", password: "short" })).rejects.toThrow("password: Use at least 12 characters; name: Required");
  });
});

describe("sample diff", () => {
  it("public/sample.diff is identical to the backend demo diff", () => {
    const pub = readFileSync(path.resolve(__dirname, "../../public/sample.diff"), "utf8");
    const src = readFileSync(path.resolve(__dirname, "../../../backend/src/demo/sample-diff.ts"), "utf8");
    const body = src.match(/export const SAMPLE_DIFF = `([\s\S]*?)`;/)?.[1];
    expect(body).toBeDefined();
    expect(pub).toBe(body!.replace(/\\`/g, "`").replace(/\\\$/g, "$"));
  });
});
