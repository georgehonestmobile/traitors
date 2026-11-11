"use client";

import { useEffect, useState } from "react";

const KEY = "rt-hide-roles";

/** Blurs roles across the portal, e.g. while screen-sharing. Remembered per browser. */
export function RoleToggle() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(KEY) === "1";
    } catch {}
    setHidden(saved);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("hide-roles", hidden);
    try {
      localStorage.setItem(KEY, hidden ? "1" : "0");
    } catch {}
  }, [hidden]);

  return (
    <button type="button" className="btn ghost small" aria-pressed={hidden} onClick={() => setHidden((h) => !h)}>
      {hidden ? "🙈 Roles hidden" : "👁️ Hide roles"}
    </button>
  );
}
