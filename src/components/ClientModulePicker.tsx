import type { ClientModule } from '../types/borrowing';

type Props = {
  value: ClientModule[];
  onChange: (value: ClientModule[]) => void;
};

export function ClientModulePicker({ value, onChange }: Props) {
  function toggle(module: ClientModule, checked: boolean) {
    const next = checked
      ? [...value, module]
      : value.filter((item) => item !== module);
    if (next.length > 0) onChange([...new Set(next)]);
  }

  return (
    <section className="create-section">
      <h3>Platform modules</h3>
      <p className="form-hint">
        Select which services this client offers. Customers will only be able to register for enabled modules.
      </p>
      <div className="settings-row">
        <label className="register-consent" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={value.includes('invest')}
            onChange={(event) => toggle('invest', event.target.checked)}
          />
          <span>Invest</span>
        </label>
        <label className="register-consent" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={value.includes('borrow')}
            onChange={(event) => toggle('borrow', event.target.checked)}
          />
          <span>Borrow</span>
        </label>
      </div>
    </section>
  );
}
