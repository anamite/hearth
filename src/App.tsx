import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { initBackend, IS_MOCK } from '@/backend';
import { LandingScreen } from '@/screens/Landing';
import { CreateScreen, JoinScreen } from '@/screens/CreateJoin';
import { LobbyScreen } from '@/screens/Lobby';
import { SettingsScreen } from '@/screens/Settings';
import { PlayScreen } from '@/screens/Play';
import { HistoryScreen } from '@/screens/History';
import { Loading, Screen } from '@/components/ui';
import { DevBadge } from '@/components/DevBadge';

export default function App() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Spec §4.1 — identity is established silently, with no UI at all.
  useEffect(() => {
    initBackend().then(
      () => setReady(true),
      () => setFailed(true),
    );
  }, []);

  if (failed) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="title">Can’t connect</p>
          <p className="subtitle">Check your connection and reload.</p>
          <button className="btn-ghost mt-3" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </Screen>
    );
  }

  if (!ready) {
    return <Screen><Loading label="Warming up…" /></Screen>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingScreen />} />
        <Route path="/create" element={<CreateScreen />} />
        <Route path="/join" element={<JoinScreen />} />
        <Route path="/g/:code" element={<LobbyScreen />} />
        <Route path="/g/:code/settings" element={<SettingsScreen />} />
        <Route path="/g/:code/play" element={<PlayScreen />} />
        <Route path="/g/:code/history" element={<HistoryScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {IS_MOCK && <DevBadge />}
    </BrowserRouter>
  );
}
