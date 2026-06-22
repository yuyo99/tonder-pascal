import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";

    const db = await connectMongo();
    const col = db.collection("business_business");

    const filter = q
      ? { name: { $regex: q, $options: "i" } }
      : {};

    const businesses = await col
      .find(filter, { projection: { id: 1, name: 1, _id: 0 } })
      .sort({ name: 1 })
      .limit(50)
      .toArray();

    return NextResponse.json({ businesses });
  } catch (err) {
    console.error("GET /api/merchants/businesses error:", err);
    return NextResponse.json({ error: "Failed to fetch businesses" }, { status: 500 });
  }
}
