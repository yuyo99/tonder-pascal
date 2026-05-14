import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/postgres";

export const dynamic = "force-dynamic";

/**
 * POST /api/simulations/jobs
 *
 * Enqueue a "Run now" request for a simulation. The Pascal backend's job
 * poller (every 10s) picks it up, runs the simulation, and updates the
 * row's status + run_id.
 *
 * Body: { simulation_id: number, triggered_by?: string }
 * Returns: { jobId, status: "pending" }
 *
 * GET /api/simulations/jobs?id=N
 *   Poll for completion. Returns { id, status, run_id, error }.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const simulationId = body.simulation_id;
    const triggeredBy = body.triggered_by ?? "dashboard";

    if (!simulationId) {
      return NextResponse.json({ error: "simulation_id required" }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO pascal_simulation_jobs (simulation_id, triggered_by)
       VALUES ($1, $2)
       RETURNING id, status, triggered_at`,
      [simulationId, triggeredBy],
    );

    return NextResponse.json(
      { jobId: result.rows[0].id, status: result.rows[0].status },
      { status: 201 },
    );
  } catch (err) {
    console.error("Simulation jobs POST error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const result = await query(
      `SELECT j.id, j.simulation_id, j.triggered_by, j.triggered_at, j.status,
              j.run_id, j.error, r.result AS run_result, r.judge_summary
         FROM pascal_simulation_jobs j
         LEFT JOIN pascal_simulation_runs r ON r.id = j.run_id
        WHERE j.id = $1`,
      [id],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "job not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("Simulation jobs GET error:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
