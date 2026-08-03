import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { serverError, unauthorized } from "@/lib/responses";

export async function GET() {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    return NextResponse.json({ reviewer });
  } catch (cause) {
    return serverError(cause);
  }
}
