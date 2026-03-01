import { NextResponse } from "next/server";

const HARDCODED_ORIGINS = [
  // Production
  "https://tender-reverence-production.up.railway.app",
  "https://candidate-intake-production.up.railway.app",
  "https://kyuujin-pdf-tool-production.up.railway.app",
  "https://ai-resume-generator-production-66cb.up.railway.app",
  // Staging
  "https://tender-reverence-staging.up.railway.app",
  "https://candidate-intake-staging.up.railway.app",
];

function getAllowedOrigins(): string[] {
  const origins = [...HARDCODED_ORIGINS];
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    const additional = envOrigins.split(",").map((o) => o.trim()).filter(Boolean);
    origins.push(...additional);
  }
  return origins;
}

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };

  const allowedOrigins = getAllowedOrigins();
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function handleCorsOptions(request: Request): NextResponse | null {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    return new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }
  return null;
}

export function withCors(response: NextResponse, origin: string | null): NextResponse {
  const headers = getCorsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}
