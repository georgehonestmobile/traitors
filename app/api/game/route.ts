import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import * as games from "@/lib/game";
import { listPlayers } from "@/lib/slack";

/**
 * Game admin. Body: { action, ... }
 *   new { name, copyCast }      end { winner }      reopen
 *   add { playerIds }           remove { playerId }
 *   role { playerId, role }     recruit { playerId }
 *   banish { playerId }         murder { playerId }  restore { playerId }
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const playerId = String(body.playerId ?? "");
  try {
    const game = await games.getCurrentGame();
    switch (body.action) {
      case "new":
        await games.startNewGame(String(body.name ?? ""), body.copyCast ? game : undefined);
        break;
      case "end":
        if (body.winner !== "faithful" && body.winner !== "traitors") throw new games.GameError("Choose a winner.");
        await games.endGame(game.id, body.winner);
        break;
      case "reopen":
        await games.reopenGame(game.id);
        break;
      case "add": {
        const ids = new Set<string>(Array.isArray(body.playerIds) ? body.playerIds.map(String) : []);
        const players = (await listPlayers()).filter((p) => ids.has(p.id));
        if (!players.length) throw new games.GameError("Choose at least one player.");
        await games.addPlayers(game.id, players);
        break;
      }
      case "remove":
        await games.removePlayer(game.id, playerId);
        break;
      case "role":
        if (body.role !== "faithful" && body.role !== "traitor") throw new games.GameError("Unknown role.");
        await games.setRole(game.id, playerId, body.role);
        break;
      case "recruit":
        await games.recruit(game.id, playerId);
        break;
      case "banish": {
        const m = game.cast.find((c) => c.playerId === playerId);
        const player = m ? { id: m.playerId, name: m.name, avatar: m.avatar } : (await listPlayers()).find((p) => p.id === playerId);
        if (!player) throw new games.GameError("Unknown player.");
        await games.banish(game.id, player);
        break;
      }
      case "murder":
        await games.murder(game.id, playerId);
        break;
      case "restore":
        await games.unbanish(game.id, { playerId });
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof games.GameError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
