/**
 * Hub02 SDK — optional React entrypoint (`@hub02/sdk/react`).
 *
 * `useHub02User()` resolves the current user and wires expiry-redirect.
 * React is a peer dependency; this module is tree-shaken out of non-React apps.
 */

import { useEffect, useState } from "react";
import { user as resolveUser, onExpire, type Hub02User } from "./client";

export interface UseHub02UserResult {
  user: Hub02User | null;
  loading: boolean;
}

/**
 * React hook returning `{ user, loading }`. Re-checks on focus and triggers
 * the default expiry redirect when the session dies.
 */
export function useHub02User(): UseHub02UserResult {
  const [user, setUser] = useState<Hub02User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    resolveUser().then((u) => {
      if (mounted) {
        setUser(u);
        setLoading(false);
      }
    });
    const unsub = onExpire();
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return { user, loading };
}
