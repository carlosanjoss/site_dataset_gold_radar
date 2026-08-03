import { NextResponse } from "next/server";

export function unauthorized() {
  return NextResponse.json(
    { error: "Sessão expirada. Entre novamente com seu código." },
    { status: 401 },
  );
}

export function serverError(cause: unknown) {
  console.error(cause);
  return NextResponse.json(
    { error: "Não foi possível concluir a operação no banco de dados." },
    { status: 500 },
  );
}
