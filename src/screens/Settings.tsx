import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { GroupSettings } from '@/types';
import { getBackend } from '@/backend';
import { useLobby } from '@/lib/useLobby';
import { GAMES } from '@/games/manifest';
import { Field, Toggle } from '@/components/SettingField';
import { useLocalStorage } from '@/lib/hooks';
import { ErrorNote, Loading, Screen, Spacer, TopBar } from '@/components/ui';
import { GameCharacter } from '@/components/art';

export function SettingsScreen() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { lobby, status, refresh } = useLobby(code);

  const [draft, setDraft] = useState<GroupSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaker, setSpeaker] = useLocalStorage(
    `hearth.speaker.${lobby?.group.id ?? 'none'}`,
    null as boolean | null,
  );

  useEffect(() => {
    if (lobby && !draft) setDraft(structuredClone(lobby.group.settings));
  }, [lobby, draft]);

  if (status === 'not_a_member') return <Navigate to={`/join?code=${code}`} replace />;
  if (!lobby || !draft) return <Screen><Loading /></Screen>;
  if (!lobby.me.is_host) return <Navigate to={`/g/${code}`} replace />;

  const amSpeaker = speaker ?? lobby.me.is_host;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await getBackend().updateGroupSettings(lobby!.group.id, draft!);
      await refresh();
      navigate(`/g/${code}`);
    } catch {
      setError('Couldn’t save — is a round running?');
      setSaving(false);
    }
  }

  return (
    <Screen>
      <TopBar
        title="Settings"
        subtitle="Changes apply to the next round, never a live one."
        onBack="history"
      />

      {GAMES.map((g) => (
        <section key={g.id} data-game={g.id} className="card-accent mb-4">
          <p className="label mb-3 flex items-center gap-2 text-accent">
            <GameCharacter game={g.id} size={22} />
            {g.name}
          </p>
          {g.settingsSchema.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={(draft as any)[g.id]?.[field.key]}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d!,
                  [g.id]: { ...(d as any)![g.id], [field.key]: v },
                }))
              }
            />
          ))}
        </section>
      ))}

      <section className="card mb-4">
        <p className="label">This device</p>
        <div className="flex items-start gap-4 py-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-chalk">Play narration here</p>
            <p className="mt-0.5 text-xs leading-relaxed text-mute">
              Night Village reads the night out loud. Exactly one phone should do it —
              by default, the host’s.
            </p>
          </div>
          <Toggle checked={amSpeaker} onChange={setSpeaker} />
        </div>
      </section>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />
      <button className="btn-primary mt-4" disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </Screen>
  );
}
