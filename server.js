import { serve } from "bun";
import { readFileSync } from "fs";
import { config } from "dotenv";
config();

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Default voice ID dari ElevenLabs

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve frontend
    if (url.pathname === "/") {
      return new Response(readFileSync("./public/index.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // ... sebelumnya tetap
    if (url.pathname === "/api/voices" && req.method === "GET") {
      const voicesRes = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: {
          "xi-api-key": API_KEY,
        },
      });
      const voices = await voicesRes.json();
      return new Response(JSON.stringify(voices), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const rateLimits = new Map(); // { ip: { count, lastRequestDate } }
    const MAX_REQUESTS_PER_DAY = 50;

    function getClientIP(req) {
      const forwarded = req.headers.get("x-forwarded-for");
      if (forwarded) {
        return forwarded.split(",")[0].trim(); // ambil IP pertama
      }

      const remoteAddr = req.headers.get("remote-addr") || req.headers.get("host");
      return remoteAddr || "unknown";
    }

    // API untuk TTS
    if (url.pathname === "/api/tts" && req.method === "POST") {
      const ip = getClientIP(req);
      const today = new Date().toISOString().split("T")[0];
      const current = rateLimits.get(ip) || { count: 0, date: today };
      const { text, voice_id } = await req.json();

      if (current.date === today) {
        if (current.count >= MAX_REQUESTS_PER_DAY) {
          return new Response(`Batas harian (${MAX_REQUESTS_PER_DAY}x) untuk IP ini telah tercapai.`, {
            status: 429,
          });
        }
        current.count++;
      } else {
        // Reset untuk hari baru
        current.count = 1;
        current.date = today;
      }

      rateLimits.set(ip, current);



      if (!text || typeof text !== "string" || text.length > 2000) {
        return new Response("Teks tidak valid atau terlalu panjang (maks 2000 karakter).", {
          status: 400,
        });
      }

      // Logging
      console.log(`IP: ${ip} | Request #${current.count} | Text length: ${text.length}`);

      // Log + kirim ke ElevenLabs
      console.log("\n=== ElevenLabs TTS Request ===");
      console.log("Voice ID:", voice_id);
      console.log("Text length:", text.length);
      console.log("Incoming headers:", Object.fromEntries(req.headers.entries()));

      const ttsResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": API_KEY,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_monolingual_v1",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        }
      );

      const audioBuffer = await ttsResponse.arrayBuffer();
      return new Response(audioBuffer, {
        headers: {
          "Content-Type": "audio/mpeg",
        },
      });
    }


    return new Response("Not found", { status: 404 });
  },
});
