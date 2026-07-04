"use client";

import { createContext, useContext } from "react";

/**
 * T-135 T-C: スカウト運用配下のクライアントに現在ユーザーの権限を配る Context。
 * scout/layout.tsx（サーバー）が getSessionUser() で判定した isAdmin を渡す。
 * これにより ScoutNav や import-legacy ページが（fetch のちらつき無しで）admin 判定できる。
 */
type ScoutRole = { isAdmin: boolean };

const ScoutRoleCtx = createContext<ScoutRole>({ isAdmin: false });

export function ScoutRoleProvider({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return <ScoutRoleCtx.Provider value={{ isAdmin }}>{children}</ScoutRoleCtx.Provider>;
}

export function useScoutRole(): ScoutRole {
  return useContext(ScoutRoleCtx);
}
