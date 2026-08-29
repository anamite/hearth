import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyView } from '@/types';
import { HearthError } from '@/types';
import { getBackend } from '@/backend';
import { HEARTBEAT_INTERVAL_MS } from './constants';
import { useInterval, usePageVisible } from './hooks';

type LobbyStatus = 'loading' | 'ok' | 'not_a_member' | 'missing' | 'error';

/**
 * Loads a group, keeps it fresh from the group channel, and beats the
 * heartbeat that keeps `expires_at` pushed out (§7.2, §18.3).
 */
export function useLobby(code: string | undefined) {
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [status, setStatus] = useState<LobbyStatus>('loading');
  const groupId = useRef<string | null>(null);
  const visible = usePageVisible();

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const next = await getBackend().getLobby(code);
      groupId.current = next.group.id;
      setLobby(next);
      setStatus('ok');
    } catch (err) {
      if (err instanceof HearthError && err.code === 'not_a_member') setStatus('not_a_member');
      else if (err instanceof HearthError && err.code === 'group_not_found') setStatus('missing');
      else setStatus((s) => (s === 'ok' ? 'ok' : 'error'));
    }
  }, [code]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Lobby membership is public, so this can be a plain subscription (§9.1).
  useEffect(() => {
    const id = lobby?.group.id;
    if (!id) return;
    return getBackend().subscribeGroup(id, () => {
      void refresh();
    });
  }, [lobby?.group.id, refresh]);

  useInterval(
    () => {
      const id = groupId.current;
      if (id) void getBackend().heartbeat(id);
    },
    visible && status === 'ok' ? HEARTBEAT_INTERVAL_MS : null,
  );

  // A slow safety net in case a broadcast is missed.
  useInterval(() => void refresh(), visible && status === 'ok' ? 5000 : null);

  return { lobby, status, refresh };
}
