import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return Response.json({ error: "Origin rejected" }, { status: 403 });
  const r = NextResponse.json({ ok: true });
  r.cookies.set("desk.session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return r;
}
