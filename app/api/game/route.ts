import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { removeFromOpenRounds } from "@/lib/departure";
import * as games from "@/lib/game";
import { listPlayers } from "@/lib/slack";

/**
 * Game admin. Body: { action, ... }
 *   new { name, copyCast }      end { winner }      reopen
 *   add { playerIds }           remove { playerId }
 *   role { playerId, role }     recruit { playerId }
 *   banish { playerId }         murder { playerId }  restore { playerId }
 *   schedule-import { text }    schedule-clear       schedule-start { value }
 *   schedule-add { date, kind } schedule-update { id, date?, kind?, skipped? }  schedule-delete { id }
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
        await removeFromOpenRounds(game.id, player);
        break;
      }
      case "murder": {
        const updated = await games.murder(game.id, playerId);
        const m = updated.cast.find((c) => c.playerId === playerId)!;
        const player = { id: m.playerId, name: m.name };
        // The murder is recorded; problems after this are reported as warnings, not errors.
        // No DM to the murdered player: the murder is announced in the channel.
        let warning: string | undefined;
        try {
          await removeFromOpenRounds(game.id, player);
        } catch (e) {
          console.error(e);
          warning = `Recorded, but ${m.name} couldn't be taken out of open votes: ${e instanceof Error ? e.message : e}`;
        }
        return NextResponse.json({ ok: true, ...(warning ? { warning } : {}) });
      }
      case "restore":
        await games.unbanish(game.id, { playerId });
        break;
      case "schedule-import":
        await games.importSchedule(game.id, String(body.text ?? ""));
        break;
      case "schedule-clear":
        await games.clearSchedule(game.id);
        break;
      case "schedule-start":
        await games.setPlannedStart(game.id, Number(body.value));
        break;
      case "schedule-add":
        await games.addScheduleItem(game.id, String(body.date ?? ""), body.kind);
        break;
      case "schedule-update":
        await games.updateScheduleItem(game.id, String(body.id ?? ""), {
          ...(body.date !== undefined ? { date: String(body.date) } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.skipped !== undefined ? { skipped: body.skipped === true } : {}),
        });
        break;
      case "schedule-delete":
        await games.deleteScheduleItem(game.id, String(body.id ?? ""));
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
