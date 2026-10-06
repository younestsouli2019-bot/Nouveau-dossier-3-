import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function prismaClientLoaded(): Promise<boolean> {
  try {
    const mod = await import("@prisma/client");
    if (!mod?.PrismaClient) return false;
    return true;
  } catch {
    return false;
  }
}

function nextVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("next/package.json").version || "unknown";
  } catch {
    return "unknown";
  }
}

export async function GET() {
  const commitSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA ||
    "local-dev";
  const builtAt = process.env.BUILT_AT || new Date().toISOString();
  const prismaOk = await prismaClientLoaded();
  return NextResponse.json(
    {
      status: "ok",
      commit_sha: commitSha.substring(0, 40),
      built_at: builtAt,
      node_version: process.versions.node,
      next_version: nextVersion(),
      prisma_client_loaded: prismaOk,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
