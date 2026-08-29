import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AvatarKey } from '@/types';
import { HearthError } from '@/types';
import { getBackend } from '@/backend';
import { Screen, TopBar, Spacer, ErrorNote } from '@/components/ui';
import { AvatarPicker, NicknamePicker, TurnstileGate } from '@/components/IdentityPicker';
import { AVATAR_KEYS, CODE_ALPHABET, CODE_LENGTH } from '@/lib/constants';

const MESSAGES: Record<string, string> = {
  bad_pin: 'That PIN doesn’t match.',
  group_not_found: 'No group with that code.',
  group_full: 'That group is full (12 players).',
  nickname_taken: 'Someone just took that name — pick another.',
  rate_limited: 'Too many tries. Wait a minute and try again.',
  not_a_member: 'You’re not in that group.',
  network: 'Couldn’t reach the server.',
};

function message(err: unknown): string {
  if (err instanceof HearthError) return MESSAGES[err.code] ?? err.message;
  return 'Something went wrong. Try again.';
}

function randomAvatar(): AvatarKey {
  return AVATAR_KEYS[Math.floor(Math.random() * AVATAR_KEYS.length)];
}

function PinInput({
  value,
  onChange,
  label,
  help,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  help?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="field text-center font-mono text-2xl tracking-[0.4em]"
        inputMode="numeric"
        autoComplete="off"
        placeholder="••••"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      {help && <p className="mt-2 text-xs text-mute">{help}</p>}
    </div>
  );
}

// ---------------------------------------------------------------
// Create
// ---------------------------------------------------------------

export function CreateScreen() {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<AvatarKey>(randomAvatar);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onToken = useCallback((t: string) => setToken(t || null), []);
  const valid = pin.length >= 4 && !!nickname && !!token;

  async function create() {
    if (!valid || !nickname) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getBackend().createGroup({
        pin,
        nickname,
        avatarKey: avatar,
        turnstileToken: token!,
      });
      navigate(`/g/${res.code}`, { replace: true });
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar
        title="Start a group"
        subtitle="Pick a PIN and read it out. That’s the whole setup."
        onBack="history"
      />

      <div className="space-y-6">
        <PinInput
          value={pin}
          onChange={setPin}
          label="Group PIN (4–6 digits)"
          help="Everyone types this once to get in. Say it out loud — it never leaves the room."
        />
        <NicknamePicker value={nickname} available={null} onChange={setNickname} />
        <AvatarPicker value={avatar} onChange={setAvatar} />
        <TurnstileGate onToken={onToken} />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <button className="btn-primary mt-6" disabled={!valid || busy} onClick={create}>
        {busy ? 'Creating…' : 'Create the group'}
      </button>
    </Screen>
  );
}

// ---------------------------------------------------------------
// Join
// ---------------------------------------------------------------

export function JoinScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase());
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<AvatarKey>(randomAvatar);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [available, setAvailable] = useState<string[] | null>(null);
  const [peek, setPeek] = useState<{ display_name: string; player_count: number } | null>(null);

  const onToken = useCallback((t: string) => setToken(t || null), []);
  const codeReady = code.length === CODE_LENGTH;

  // Look the group up as soon as the code is complete, so the name list
  // only ever offers names that are actually free (§16.1).
  useEffect(() => {
    if (!codeReady) {
      setPeek(null);
      setAvailable(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const found = await getBackend().peekGroup(code);
        if (cancelled) return;
        setPeek(found);
        if (found) {
          const names = await getBackend().availableNicknames(code);
          if (!cancelled) setAvailable(names);
        }
      } catch {
        /* the join attempt will surface the real error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, codeReady]);

  const valid = codeReady && pin.length >= 4 && !!nickname && !!token;

  async function join() {
    if (!valid || !nickname) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getBackend().joinGroup({
        code,
        pin,
        nickname,
        avatarKey: avatar,
        turnstileToken: token!,
      });
      navigate(`/g/${res.code}`, { replace: true });
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title="Join a group" subtitle="Ask for the code and the PIN." onBack="history" />

      <div className="space-y-6">
        <div>
          <label className="label">Group code</label>
          <input
            className="field text-center font-mono text-2xl uppercase tracking-[0.3em]"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="K7M2QX"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(e) => {
              const next = e.target.value
                .toUpperCase()
                .split('')
                .filter((c) => CODE_ALPHABET.includes(c))
                .join('')
                .slice(0, CODE_LENGTH);
              setCode(next);
            }}
          />
          {codeReady && (
            <p className={`mt-2 text-xs ${peek ? 'text-moss' : 'text-blood'}`}>
              {peek
                ? `${peek.display_name} · ${peek.player_count} here`
                : 'No group with that code'}
            </p>
          )}
        </div>

        <PinInput value={pin} onChange={setPin} label="PIN" />
        <NicknamePicker value={nickname} available={available} onChange={setNickname} />
        <AvatarPicker value={avatar} onChange={setAvatar} />
        <TurnstileGate onToken={onToken} />
      </div>

      <ErrorNote>{error}</ErrorNote>
      <Spacer />

      <button className="btn-primary mt-6" disabled={!valid || busy} onClick={join}>
        {busy ? 'Joining…' : 'Join'}
      </button>
    </Screen>
  );
}
