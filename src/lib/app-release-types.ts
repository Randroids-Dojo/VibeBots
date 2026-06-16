export interface AppReleaseChange {
  build: number | null;
  text: string;
}

export interface AppRelease {
  noticeId: string;
  version: string;
  build: number | null;
  ref: string;
  showToAll: boolean;
  changes: AppReleaseChange[];
}
