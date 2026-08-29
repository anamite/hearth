import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { GroupSettings } from '@/types';
import { getBackend } from '@/backend';
import { useLobby } from '@/lib/useLobby';
import { GAMES } from '@/games/manifest';
import type { SettingField } from '@/games/types';
import { useLocalStorage } from '@/lib/hooks';
import { ErrorNote, Loading, Screen, Spacer, TopBar } from '@/components/ui';

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
        checked ? 'bg-ember' : 'bg-edge'
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-chalk transition-all ${
          checked ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: any;
  onChange: (v: any) => void;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-edge/50 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-chalk">{field.label}</p>
        {field.help && <p className="mt-0.5 text-xs leading-relaxed text-mute">{field.help}</p>}
      </div>

      {field.type === 'toggle' && <Toggle checked={!!value} onChange={onChange} />}

      {field.type === 'number' && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="h-8 w-8 rounded-lg border border-edge text-mute active:scale-90"
            onClick={() => onChange(Math.max(field.min, (value ?? 0) - (field.step ?? 1)))}
          >
            −
          </button>
          <span className="w-14 text-center text-sm font-semibold tabular-nums text-chalk">
            {value ?? 0}
            {field.unit ?? ''}
          </span>
          <button
            className="h-8 w-8 rounded-lg border border-edge text-mute active:scale-90"
            onClick={() => onChange(Math.min(field.max, (value ?? 0) + (field.step ?? 1)))}
          >
            +
          </button>
        </div>
      )}

      {field.type === 'select' && (
        <select
          className="shrink-0 rounded-xl border border-edge bg-ink px-2.5 py-2 text-sm text-chalk"
          value={value ?? field.options[0].value}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

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
        <section key={g.id} className="card mb-4">
          <p className="label">{g.name}</p>
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
            <p className="text-sm font-semibold text-chalk">Play narration here</p>
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
