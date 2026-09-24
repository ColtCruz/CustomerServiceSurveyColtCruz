import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://coltcruz.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const { participantId, role, mode } = await req.json();

    if (
      typeof participantId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participantId)
    ) {
      return new Response("Invalid participant ID", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const forwardedFor = req.headers.get("x-forwarded-for") || "";
    const ipAddress =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      forwardedFor.split(",")[0].trim() ||
      null;

    if (!ipAddress) {
      console.error("Unable to determine client IP");
      return new Response("Unable to determine client IP", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const userAgent = req.headers.get("user-agent");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server environment is not configured.");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabase
      .from("participant_sessions")
      .upsert(
        {
          participantId,
          ipAddress,
          ipHash: "raw-ip-retained",
          userAgent,
          role: typeof role === "string" ? role : null,
          mode: typeof mode === "string" ? mode : null,
        },
        {
          onConflict: "participantId",
          ignoreDuplicates: true,
        }
      );

    if (error) {
      console.error("Database error:", error);
      throw error;
    }

    console.log("Participant session captured:", { participantId, role, mode });

    return Response.json(
      { success: true },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error("capture-session error:", error);
    return Response.json(
      { success: false },
      { status: 500, headers: corsHeaders }
    );
  }
});
