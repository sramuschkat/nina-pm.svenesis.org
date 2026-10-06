/**
 * Client für das NINA-Plugin „Advanced API“ (christian-photo/ninaAPI, `/v2/api`, Antwort
 * `{Response, Error, StatusCode, Success, Type}`): Geräte verbinden, Profilwerte setzen, Sequenz laden und starten,
 * Reiter wechseln, Screenshots. Nur für die Test-VM – die Advanced API hat keine Anmeldung.
 */
export interface ApiAnswer<T = unknown> {
  readonly Response: T;
  readonly Error: string;
  readonly StatusCode: number;
  readonly Success: boolean;
}

export type Device =
  | 'camera'
  | 'mount'
  | 'filterwheel'
  | 'focuser'
  | 'rotator'
  | 'guider'
  | 'safetymonitor'
  | 'dome'
  | 'flatdevice'
  | 'weather'
  | 'switch';

export interface FlatDeviceInfo {
  readonly Connected: boolean;
  readonly CoverState: string;
  readonly LightOn: boolean;
  readonly Brightness: number;
}

/** Abschnitt des NINA-Profils je Gerätetyp (Antwort von `/profile/show?active=true`). */
const PROFILE_KEYS: Record<Device, string> = {
  camera: 'CameraSettings',
  mount: 'TelescopeSettings',
  filterwheel: 'FilterWheelSettings',
  focuser: 'FocuserSettings',
  rotator: 'RotatorSettings',
  guider: 'GuiderSettings',
  safetymonitor: 'SafetyMonitorSettings',
  dome: 'DomeSettings',
  flatdevice: 'FlatDeviceSettings',
  weather: 'WeatherDataSettings',
  switch: 'SwitchSettings',
};

export class AdvancedApi {
  readonly base: string;

  constructor(host: string, port: number) {
    this.base = `http://${host}:${String(port)}/v2/api`;
  }

  async get<T = unknown>(
    path: string,
    query: Record<string, string | number | boolean> = {},
  ): Promise<ApiAnswer<T>> {
    const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const res = await fetch(`${this.base}${path}${q.size ? `?${q.toString()}` : ''}`, {
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json()) as ApiAnswer<T>;
    if (!body.Success)
      throw new Error(`Advanced API ${path}: ${body.Error || String(body.StatusCode)}`);
    return body;
  }

  /** Erreichbar und Version (wartet höchstens `timeoutMs`). */
  /** Antwortet NINA (Advanced API) binnen 5 s? Für den Absturz-Wächter im Lauf. */
  async alive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/version`, { signal: AbortSignal.timeout(5_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async waitUntilUp(timeoutMs: number): Promise<string> {
    const end = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < end) {
      try {
        return String((await this.get('/version')).Response);
      } catch (e) {
        last = String(e);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw new Error(`Advanced API unter ${this.base} nicht erreichbar: ${last}`);
  }

  /**
   * Gerät verbinden, das im aktiven Profil ausgewählt ist. Nach dem NINA-Start kennt NINA die per Alpaca-Discovery
   * gefundenen Geräte erst nach einem Rescan; ohne `to` antwortet die API dann „Invalid Id“ (Prüfstand 03.10.2026).
   */
  async connectFromProfile(device: Device, profile: Record<string, unknown>): Promise<string> {
    const settings = (profile[PROFILE_KEYS[device]] ?? {}) as {
      Id?: string | null;
      GuiderName?: string;
    };
    const id = settings.Id ?? settings.GuiderName;
    if (!id || id.startsWith('No_')) throw new Error(`${device}: im Profil kein Gerät ausgewählt`);
    const list = (await this.get<{ Id: string }[]>(`/equipment/${device}/rescan`)).Response;
    if (!list.some((d) => d.Id === id))
      throw new Error(`${device}: ${id} nach dem Rescan nicht gefunden`);
    await this.get(`/equipment/${device}/connect`, { to: id });
    return id;
  }

  /** Zustand des Flat-Panels (Abdeckung, Licht, Helligkeit). */
  async flatDeviceInfo(): Promise<FlatDeviceInfo> {
    return (await this.get<FlatDeviceInfo>('/equipment/flatdevice/info')).Response;
  }

  async activeProfile(): Promise<Record<string, unknown>> {
    return (await this.get<Record<string, unknown>>('/profile/show', { active: true })).Response;
  }

  disconnect(device: Device): Promise<ApiAnswer> {
    return this.get(`/equipment/${device}/disconnect`);
  }

  setProfile(settingPath: string, value: string | number | boolean): Promise<ApiAnswer> {
    return this.get('/profile/change-value', { settingpath: settingPath, newValue: value });
  }

  cool(temperatureC: number): Promise<ApiAnswer> {
    return this.get('/equipment/camera/cool', { temperature: temperatureC, minutes: -1 });
  }

  async sequences(): Promise<string[]> {
    return (await this.get<string[]>('/sequence/list-available')).Response;
  }

  loadSequence(name: string): Promise<ApiAnswer> {
    return this.get('/sequence/load', { sequenceName: name });
  }

  startSequence(): Promise<ApiAnswer> {
    return this.get('/sequence/start', { skipValidation: true });
  }

  stopSequence(): Promise<ApiAnswer> {
    return this.get('/sequence/stop');
  }

  switchTab(
    tab: 'equipment' | 'skyatlas' | 'framing' | 'flatwizard' | 'sequencer' | 'imaging' | 'options',
  ): Promise<ApiAnswer> {
    return this.get('/application/switch-tab', { tab });
  }

  /**
   * Abstand der VM-Ortszeit zu UTC (ms, auf 15 min gerundet) aus dem jüngsten Logeintrag – NINA schreibt
   * Zeitstempel in Ortszeit ohne Zone.
   */
  async localOffsetMs(): Promise<number> {
    const r = await this.get<{ Timestamp?: string }[]>('/application/logs', {
      lineCount: 5,
      level: 'INFO',
    });
    const latest = (r.Response ?? [])
      .map((e) => e.Timestamp ?? '')
      .sort()
      .at(-1);
    if (!latest) return 0;
    const step = 15 * 60_000;
    return Math.round((Date.parse(`${latest.slice(0, 19)}Z`) - Date.now()) / step) * step;
  }

  /** Letzte Zeilen des NINA-Logs (`Message`), ab Stufe INFO. */
  async logMessages(lineCount = 300): Promise<string[]> {
    const r = await this.get<{ Message?: string }[]>('/application/logs', {
      lineCount,
      level: 'INFO',
    });
    return (r.Response ?? []).map((e) => e.Message ?? '');
  }

  /** Screenshot des NINA-Fensters als PNG. */
  async screenshot(): Promise<Buffer> {
    const res = await fetch(`${this.base}/application/screenshot?stream=true`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Screenshot: HTTP ${String(res.status)}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
