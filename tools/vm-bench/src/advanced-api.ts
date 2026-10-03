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

  connect(device: Device): Promise<ApiAnswer> {
    return this.get(`/equipment/${device}/connect`);
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

  /** Screenshot des NINA-Fensters als PNG. */
  async screenshot(): Promise<Buffer> {
    const res = await fetch(`${this.base}/application/screenshot?stream=true`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Screenshot: HTTP ${String(res.status)}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
