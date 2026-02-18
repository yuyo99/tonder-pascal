import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";

/**
 * GET /api/merchants/businesses/resolve?ids=1,2,3
 * Batch-resolve business IDs to names from MongoDB.
 * Returns { names: { "1": "BusinessName", "2": "OtherBiz" } }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids") || "";
    const ids = idsParam
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    if (ids.length === 0) {
      return NextResponse.json({ names: {} });
    }

    const db = await connectMongo();
    const col = db.collection("business_business");

    const businesses = await col
      .find({ id: { $in: ids } }, { projection: { id: 1, name: 1, _id: 0 } })
      .toArray();

    const names: Record<string, string> = {};
    for (const biz of businesses) {
      names[String(biz.id)] = biz.name || `Business ${biz.id}`;
    }

    return NextResponse.json({ names });
  } catch (err) {
    console.error("GET /api/merchants/businesses/resolve error:", err);
    return NextResponse.json({ error: "Failed to resolve business names" }, { status: 500 });
  }
}
