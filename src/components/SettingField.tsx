import type { SettingField } from '@/games/types';

/** Shared by the Settings screen and the start-game sheet in the lobby. */
export function Toggle({
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
      className={`relative h-8 w-14 shrink-0 rounded-full border-2 transition ${
        checked ? 'border-black/40 bg-accent' : 'border-edge bg-ink/60'
      }`}
    >
      <span
        className={`absolute top-[0.15rem] h-5 w-5 rounded-full border-2 border-black/30
          bg-chalk transition-all ${checked ? 'left-[1.8rem]' : 'left-[0.15rem]'}`}
      />
    </button>
  );
}

export function Field({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: any;
  onChange: (v: any) => void;
}) {
  return (
    <div className="flex items-start gap-4 border-b-2 border-edge/40 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-chalk">{field.label}</p>
        {field.help && <p className="mt-0.5 text-xs leading-relaxed text-mute">{field.help}</p>}
      </div>

      {field.type === 'toggle' && <Toggle checked={!!value} onChange={onChange} />}

      {field.type === 'number' && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="h-9 w-9 rounded-xl border-2 border-edge bg-slatey/70 text-lg font-black
                       text-chalk shadow-pop-sm transition-all duration-100
                       active:translate-y-[3px] active:shadow-none"
            onClick={() => onChange(Math.max(field.min, (value ?? 0) - (field.step ?? 1)))}
          >
            −
          </button>
          <span className="w-14 text-center text-sm font-extrabold tabular-nums text-chalk">
            {value ?? 0}
            {field.unit ?? ''}
          </span>
          <button
            className="h-9 w-9 rounded-xl border-2 border-edge bg-slatey/70 text-lg font-black
                       text-chalk shadow-pop-sm transition-all duration-100
                       active:translate-y-[3px] active:shadow-none"
            onClick={() => onChange(Math.min(field.max, (value ?? 0) + (field.step ?? 1)))}
          >
            +
          </button>
        </div>
      )}

      {field.type === 'select' && (
        <select
          className="shrink-0 rounded-xl border-2 border-edge bg-ink px-2.5 py-2 text-sm font-bold text-chalk"
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
