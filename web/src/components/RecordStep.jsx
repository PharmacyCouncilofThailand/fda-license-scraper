import { CHECK_GROUPS, FIELDS } from '../lib/form-fields.js';

/* The officers' list is served as a plain script so the record page can read
   it too — see web/public/officers.js. */
const OFFICERS = typeof window === 'undefined' ? [] : window.OFFICERS || [];

function Field({ field, value, onChange }) {
  if (field.type === 'officers') {
    return (
      <label className="record-field">
        <span>{field.label}</span>
        <input
          type="text"
          value={value}
          list="officer-names"
          onChange={(event) => onChange(field.name, event.target.value)}
        />
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <label className="record-field">
        <span>{field.label}</span>
        <textarea rows={3} value={value} onChange={(event) => onChange(field.name, event.target.value)} />
      </label>
    );
  }
  return (
    <label className="record-field">
      <span>{field.label}</span>
      <input
        type={field.type === 'time' ? 'time' : field.type === 'number' ? 'number' : 'text'}
        inputMode={field.type === 'number' ? 'numeric' : undefined}
        value={value}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
    </label>
  );
}

/* A group where only one may be on is the paper's own pair of boxes — which
   an officer can tick both of by accident. Here they cannot. Pressing the one
   already on turns it off, because "neither" is a real answer on this form. */
function CheckGroup({ group, checks, onCheck }) {
  return (
    <fieldset className="record-checks">
      <legend>{group.label}</legend>
      {group.options.map((option) => {
        const on = Boolean(checks[option.name]);
        return (
          <button
            type="button"
            key={option.name}
            className={on ? 'check-option on' : 'check-option'}
            aria-pressed={on}
            onClick={() => onCheck(group, option.name, !on)}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export default function RecordStep({ step, values, checks, onChange, onCheck }) {
  const fields = FIELDS.filter((field) => field.step === step);
  const groups = CHECK_GROUPS.filter((group) => group.step === step);
  return (
    <div className="record-step">
      <datalist id="officer-names">
        {OFFICERS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {groups.map((group) => (
        <CheckGroup key={group.group} group={group} checks={checks} onCheck={onCheck} />
      ))}
      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          value={values[field.name] || ''}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
