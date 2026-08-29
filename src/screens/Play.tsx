import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HearthError } from '@/types';
import { getBackend } from '@/backend';
import { useLobby } from '@/lib/useLobby';
import { useRoundStore } from '@/store/round';
import { gameModule } from '@/games/manifest';
import { POLL_INTERVAL_MS } from '@/lib/constants';
import { useInterval, usePageVisible, useWakeLock } from '@/lib/hooks';
import { Loading, ReconnectBanner, Screen, Spacer, TopBar } from '@/components/ui';
import type { PhaseProps } from '@/games/types';

const ACTION_MESSAGES: Record<string, string> = {
  wrong_phase: 'Too late — the phase moved on.',
  not_your_turn: 'Not your turn.',
  already_acted: 'You already did that.',
  invalid_target: 'You can’t pick that one.',
  not_a_member: 'You’re not in this round.',
};

/** Spec §15.4 — back out of a live round only on purpose. */
function useLeaveGuard(active: boolean, onLeave: () => void) {
  useEffect(() => {
    if (!active) return;
    history.pushState(null, '', location.href);
    const onPop = () => {
      if (confirm('Leave the game?')) onLeave();
      else history.pushState(null, '', location.href);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [active, onLeave]);
}

export function PlayScreen() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { lobby } = useLobby(code);
  const visible = usePageVisible();

  const { view, status, attach, detach, refresh, submit } = useRoundStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storedRoundId = useRoundStore((s) => s.roundId);

  const roundId = lobby?.active_round?.round_id ?? storedRoundId;

  useEffect(() => {
    if (roundId) attach(roundId);
  }, [roundId, attach]);

  // First read as soon as we have a round.
  useEffect(() => {
    if (roundId) void refresh();
  }, [roundId, refresh]);

  /**
   * Spec §9.2 — realtime is a latency optimisation, polling is the
   * correctness guarantee. Both call the same advance_if_due.
   */
  useInterval(() => void refresh(), roundId && visible ? POLL_INTERVAL_MS : null);

  useEffect(() => {
    if (!roundId) return;
    return getBackend().subscribeRound(roundId, () => void refresh());
  }, [roundId, refresh]);

  useWakeLock(!!roundId && !view?.result);

  const leave = useCallback(() => {
    detach();
    navigate(`/g/${code}`, { replace: true });
  }, [detach, navigate, code]);

  useLeaveGuard(!!view && !view.result, leave);

  const doSubmit = useCallback(
    async (kind: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      setError(null);
      try {
        await submit(kind, payload);
      } catch (err) {
        const c = err instanceof HearthError ? err.code : 'network';
        setError(ACTION_MESSAGES[c] ?? 'That didn’t go through.');
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [submit, refresh],
  );

  // Clear a stale action error as soon as the phase moves on.
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (view && view.phase !== lastPhase.current) {
      lastPhase.current = view.phase;
      setError(null);
    }
  }, [view]);

  if (!roundId) {
    return (
      <Screen>
        <TopBar title="No round running" onBack={() => navigate(`/g/${code}`)} />
        <p className="subtitle">Nothing is in progress right now.</p>
        <Spacer />
        <Link to={`/g/${code}`} className="btn-primary">
          Back to the lobby
        </Link>
      </Screen>
    );
  }

  if (!view) {
    return (
      <Screen>
        <ReconnectBanner show={status === 'reconnecting'} />
        <Loading label="Dealing you in…" />
      </Screen>
    );
  }

  const game = gameModule(view.game_type);
  const Phase = game?.phaseComponents[view.phase];
  const me = view.players.find((p) => p.player_id === view.me.player_id);

  if (!game || !Phase || !me) {
    return (
      <Screen>
        <ReconnectBanner show={status === 'reconnecting'} />
        <TopBar title={game?.name ?? view.game_type} subtitle={`Phase: ${view.phase}`} />
        <p className="subtitle">
          This phase has no screen yet. The round is still running — hold tight.
        </p>
        <Spacer />
        <button className="btn-quiet" onClick={leave}>
          Back to the lobby
        </button>
      </Screen>
    );
  }

  const props: PhaseProps = { view, me, submit: doSubmit, busy, error };

  return (
    <Screen>
      <ReconnectBanner show={status === 'reconnecting'} />
      <div className="mb-4 flex items-center justify-between">
        <span className="pill">{game.name}</span>
        {view.day_number > 0 && <span className="pill">Day {view.day_number}</span>}
      </div>

      {/* The router knows nothing about any specific game (§15.3). */}
      <Phase {...props} />

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-blood">
          {error}
        </p>
      )}
    </Screen>
  );
}
