/**
 * Symbole je Bereich und Aktion (specs/ui/components.md §3): Lucide, Strichstärke 2, 16/20/24 px.
 * Seiten importieren Symbole **nur** von hier, damit dasselbe Symbol überall dasselbe bedeutet. Kein Emoji.
 */
import {
  Activity,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  Bell,
  CalendarDays,
  CalendarRange,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  Contrast,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FlipHorizontal2,
  FolderKanban,
  GripVertical,
  Loader,
  Lock,
  LockOpen,
  LogOut,
  MapPin,
  Maximize,
  MessageSquare,
  Minimize,
  Minus,
  Moon,
  MoonStar,
  Mountain,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Reply,
  Satellite,
  Save,
  Send,
  Settings,
  Smile,
  SmilePlus,
  Sparkles,
  Star,
  Sun,
  Telescope,
  ThumbsUp,
  Trash,
  Trash2,
  TriangleAlert,
  Undo2,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

export const ICON_SIZE = { table: 16, button: 20, nav: 24 } as const;

/** Navigationsbereiche (FK 14.2). */
export const areaIcons = {
  /** Startseite „Heute“ (Übersicht und Heute Nacht in einem, AP-73). */
  today: MoonStar,
  equipment: Telescope,
  planning: Compass,
  projects: FolderKanban,
  nina: PlugZap,
  /** Rig-Zustand (Telemetrie Mini-PC und Powerbox, AP-67, eigener Menüpunkt seit 08.10.2026). */
  rigStatus: Activity,
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
  /** Kommentar beantworten bzw. bearbeiten (FA-PRJ-17). */
  reply: Reply,
  edit: Pencil,
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
  /** Datumswahl der Nacht mit Mondkalender (Planung). */
  calendar: CalendarDays,
  /** Griff zum Ziehen (Rangfolge S-32, Priorität S-30). */
  drag: GripVertical,
  /** Sortierbarer Spaltenkopf ohne aktive Sortierung (DataTable, AP-26a). */
  sortable: ArrowUpDown,
  /** Detailzeile auf-/zuklappen (DataTable, AP-26a). */
  detailClosed: ChevronRight,
  detailOpen: ChevronDown,
  /** Saisondiagramm eines Objekts (Objektbrowser, AP-26d). */
  season: CalendarRange,
  /** Aktiven Filter entfernen (Chip in der FilterBar, AP-26c). */
  remove: X,
  /** Sternkarte (Knopfleiste nach Vorlage, 28.09.2026): zoomen, zur vorigen/nächsten Himmelsrichtung drehen,
   *  Rundblick (Horizont unten, 150°). */
  zoomIn: Plus,
  zoomOut: Minus,
  turnLeft: ChevronLeft,
  turnRight: ChevronRight,
  overview: Mountain,
  /** Karte im Vollbild bzw. zurück (Sternkarte, AP-26f). */
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  /** Seitenbereich rechts ein-/ausklappen (Sternkarte, AP-26i). */
  panelClose: PanelRightClose,
  panelOpen: PanelRightOpen,
  /** Meridian-Flip im Transitfenster (Transitsuche S-22, AP-42). */
  meridianFlip: FlipHorizontal2,
  /** Kommentare am Projekt (Sprechblase mit Zahl), Emoji einfügen, Reaktion hinzufügen (FA-PRJ-17). */
  comments: MessageSquare,
  emoji: Smile,
  react: SmilePlus,
} as const;

/** Gruppen von „Ereignisse der Nacht“ (Heute Nacht; Vorlage ⌁ ✧ ✺ ◑). */
export const skyEventIcons = {
  satellites: Satellite,
  showers: Sparkles,
  galacticCentre: Orbit,
  eclipses: Contrast,
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
