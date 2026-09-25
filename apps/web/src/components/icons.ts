/**
 * Symbole je Bereich und Aktion (specs/ui/components.md §3): Lucide, Strichstärke 2, 16/20/24 px.
 * Seiten importieren Symbole **nur** von hier, damit dasselbe Symbol überall dasselbe bedeutet. Kein Emoji.
 */
import {
  ArchiveRestore,
  Bell,
  ChartLine,
  Check,
  CircleHelp,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Compass,
  Copy,
  FolderKanban,
  Minus,
  Moon,
  MoonStar,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  PlugZap,
  RefreshCw,
  Save,
  Send,
  Settings,
  Sun,
  Telescope,
  Trash,
  Trash2,
  TriangleAlert,
  Undo2,
  User,
  Users,
  X,
  Loader,
  LogOut,
  ChevronDown,
  ArrowLeftRight,
  Crown,
  Lock,
  LockOpen,
  UserPlus,
  Plus,
  MapPin,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Star,
  GripVertical,
  ThumbsUp,
  Download,
} from 'lucide-react';

export const ICON_SIZE = { table: 16, button: 20, nav: 24 } as const;

/** Navigationsbereiche (FK 14.2). */
export const areaIcons = {
  tonight: MoonStar,
  equipment: Telescope,
  planning: Compass,
  projects: FolderKanban,
  nina: PlugZap,
  weather: CloudSun,
  evaluation: ChartLine,
  administration: Users,
  system: Settings,
} as const;

/** Aktionen. */
export const actionIcons = {
  save: Save,
  submit: Send,
  approve: Check,
  return: Undo2,
  reject: X,
  simulate: Play,
  duplicate: Copy,
  delete: Trash2,
  deleted: Trash,
  restore: ArchiveRestore,
  warning: TriangleAlert,
  logout: LogOut,
  switchTenant: ArrowLeftRight,
  lock: Lock,
  unlock: LockOpen,
  invite: UserPlus,
  transferOwner: Crown,
  add: Plus,
  map: MapPin,
  /** Klonen (Mondprofile) = Duplizieren (components.md §3). */
  clone: Copy,
  /** Favorit (FA-PRJ-16), Zurück, externer Recherche-Link (S-31, AP-11b). */
  favorite: Star,
  /** Stimme in der Warteschlange (FA-FRG-14, S-33). */
  vote: ThumbsUp,
  back: ArrowLeft,
  external: ExternalLink,
  /** Export als Datei (Planprotokoll CSV, S-40). */
  export: Download,
  /** Aktualisieren (S-41). */
  refresh: RefreshCw,
} as const;

/** Rahmen und Status. */
export const uiIcons = {
  notifications: Bell,
  themeLight: Sun,
  themeDark: Moon,
  user: User,
  help: CircleHelp,
  ok: Check,
  failed: X,
  unchecked: Minus,
  loading: Loader,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  menu: ChevronDown,
  up: ArrowUp,
  down: ArrowDown,
  /** Vorige/nächste Nacht (Nachtdiagramm im Projekt-Editor). */
  previous: ChevronLeft,
  next: ChevronRight,
  /** Griff zum Ziehen (Rangfolge S-32, Priorität S-30). */
  drag: GripVertical,
} as const;

/**
 * Wettersymbole nach WMO-Code (AP-23, `WeatherChart`; Zuordnung wie `wxSymbol` in
 * legacy/…/weather-core.js, dort als Emoji – hier Lucide, rules/ui.md). Nachts Mond statt Sonne.
 */
export const weatherIcons = {
  clearDay: Sun,
  clearNight: Moon,
  partlyDay: CloudSun,
  partlyNight: CloudMoon,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunder: CloudLightning,
} as const;
