/* eslint-disable @next/next/no-img-element */
import type { Player } from "@/lib/store";

export function Avatar({ player }: { player: Player }) {
  if (player.avatar) return <img className="avatar" src={player.avatar} alt="" />;
  return <span className="avatar" aria-hidden>{player.name.slice(0, 1).toUpperCase()}</span>;
}
