export interface AppReleaseChange {
  build: number | null;
  text: string;
}

export interface AppReleaseNote {
  version: string;
  date: string;
  title: string;
  intro?: string;
  changes: AppReleaseChange[];
}

export interface AppRelease {
  noticeId: string;
  version: string;
  build: number | null;
  ref: string;
  showToAll: boolean;
  intro?: string;
  changes: AppReleaseChange[];
  notes: AppReleaseNote[];
}
