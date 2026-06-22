export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  if (!status || !["answered", "dismissed"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const result = await query(
    `UPDATE pascal_knowledge_gaps
     SET status = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, status`,
    [status, id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Gap not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
