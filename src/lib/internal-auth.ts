import { NextRequest } from "next/server";

export function validateInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) return false;
  return apiKey === expectedKey;
}
