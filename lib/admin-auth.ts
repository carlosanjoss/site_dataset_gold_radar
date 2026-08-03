import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { unauthorized } from "@/lib/responses";

export async function requireAdmin() {
  const reviewer = await getAuthenticatedReviewer();
  if (!reviewer) return { reviewer: null, response: unauthorized() };
  if (reviewer.mustChangePassword) {
    return {
      reviewer,
      response: NextResponse.json(
        { error: "Troque sua senha antes de continuar." },
        { status: 403 },
      ),
    };
  }
  if (reviewer.role !== "admin") {
    return {
      reviewer,
      response: NextResponse.json(
        { error: "Acesso exclusivo do administrador." },
        { status: 403 },
      ),
    };
  }
  return { reviewer, response: null };
}
