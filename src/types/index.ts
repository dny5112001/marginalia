export interface VaultInfo {
  path: string;
  name: string;
  lastOpened: number;
}

export interface FileEntry {
  /** Vault-relative, `/`-separated path. */
  path: string;
  kind: "file" | "dir";
  size: number;
  mtime: number;
}

export interface TextFile {
  path: string;
  content: string;
  mtime: number;
}

export type BackendErrorKind =
  | "noVault"
  | "invalidPath"
  | "outsideVault"
  | "notFound"
  | "alreadyExists"
  | "permissionDenied"
  | "conflict"
  | "notApproved"
  | "tooLarge"
  | "io";

export interface Heading {
  level: number;
  text: string;
  line: number;
  offset: number;
}

export interface LinkRef {
  /** Raw target as written, without heading/alias. e.g. `Folder/Note` */
  target: string;
  heading?: string;
  alias?: string;
  embed: boolean;
  kind: "wiki" | "markdown";
  /** Character offsets of the whole link token in the source. */
  from: number;
  to: number;
  line: number;
}

export interface TagRef {
  tag: string;
  offset: number;
  line: number;
}

export interface ParsedNote {
  path: string;
  title: string;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  links: LinkRef[];
  tags: TagRef[];
  /** Tags from both frontmatter and inline, lowercase, without `#`. */
  allTags: string[];
  aliases: string[];
  headings: Heading[];
  wordCount: number;
}

export interface Backlink {
  source: string;
  link: LinkRef;
  context: string;
}

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  snippets: { text: string; ranges: [number, number][] }[];
}

export type ThemeMode = "dark" | "light" | "system";
export type ViewMode = "edit" | "preview" | "split";

export interface Settings {
  theme: ThemeMode;
  editorFontSize: number;
  lineNumbers: boolean;
  lineWrapping: boolean;
  livePreview: boolean;
  readableLineLength: boolean;
  spellcheck: boolean;
  autosaveDelayMs: number;
  newNoteFolder: string;
  attachmentFolder: string;
  dailyNotesEnabled: boolean;
  dailyNoteFolder: string;
  templatesFolder: string;
  updateLinksOnRename: boolean;
  defaultViewMode: ViewMode;
  historyEnabled: boolean;
  historyIntervalMin: number;
  historyKeepDays: number;
  confirmDelete: boolean;
  newNoteLocation: "root" | "current" | "folder";
  dailyNoteFormat: string;
  dailyNoteTemplate: string;
}

export type TabKind = "note" | "graph" | "empty";

export interface Tab {
  id: string;
  kind: TabKind;
  /** Note path for `note` tabs. */
  path?: string;
  mode: ViewMode;
  history: string[];
  historyIndex: number;
}

export type LeftView = "files" | "search" | "tags" | "bookmarks";
export type FileSort = "name-asc" | "name-desc" | "modified-new" | "modified-old";
export type RightView = "backlinks" | "outline" | "properties" | "localGraph";

export interface WorkspaceLayout {
  tabs: Tab[];
  activeTabId: string | null;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  leftView: LeftView;
  rightView: RightView;
  expandedFolders: string[];
  recentFiles: string[];
  fileSort: FileSort;
}
