import axios from "axios";
import { useAuthStore } from "../store/auth";

export interface FileInfo {
  /** Stable row identifier. Use this, not `key`, to address a file. */
  id: number;
  /** Content-addressed R2 object key; two files may share one. */
  key: string;
  /** Folder the file is filed under; empty string means root. */
  folder: string;
  name: string;
  size: number;
  mime: string;
  /** Epoch milliseconds. */
  uploaded: number;
  width: number | null;
  height: number | null;
  thumbnail: boolean;
  missing: boolean;
}

export interface FolderInfo {
  /** Full path, e.g. `wallpapers/mac`. */
  path: string;
  /** Last path segment, for display. */
  name: string;
  /** Total files in the subtree. */
  count: number;
  /** Recent image keys that peek out of the folder card. */
  previews: string[];
}

export interface ListResult {
  folder: string;
  folders: FolderInfo[];
  files: FileInfo[];
  nextCursor: string | null;
}

export interface ShareInfo {
  token: string;
  name: string;
  /** Epoch milliseconds, or null when the link never expires. */
  expiresAt: number | null;
  hasPassword: boolean;
  visits: number;
  createdAt: number;
}

/** Mirrors `MAX_UPLOAD_BYTES` in worker/src/config.ts. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/**
 * Mirrors the format allow-list in worker/src/lib/image.ts. The Worker sniffs
 * the bytes and is the one that decides; this only spares the user a round
 * trip and an upload that was never going to be accepted.
 */
export const ACCEPTED_IMAGE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/avif": [".avif"],
};

const http = axios.create();

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Any 401 means the session is gone: log out and land on the login page.
http.interceptors.response.use(undefined, (error: unknown) => {
  if (axios.isAxiosError(error) && error.response?.status === 401) {
    useAuthStore.getState().logout();
  }
  return Promise.reject(error);
});

export const api = {
  login: async (password: string) =>
    (await http.post<{ token: string }>("/api/login", { password })).data,

  list: async (
    folder: string,
    sort = "newest",
    cursor?: string,
    signal?: AbortSignal,
  ) =>
    (
      await http.get<ListResult>("/api/list", {
        params: { folder, sort, cursor },
        signal,
      })
    ).data,

  stats: async () =>
    (await http.get<{ count: number; totalSize: number }>("/api/stats")).data,

  remove: async (id: number) => {
    await http.delete("/api/file", { params: { id } });
  },

  /** Move and/or rename. Metadata only — the stored object is untouched. */
  move: async (id: number, changes: { folder?: string; name?: string }) =>
    (
      await http.patch<{ id: number; folder: string; name: string }>(
        "/api/file",
        { id, ...changes },
      )
    ).data,

  upload: async (
    file: File,
    folder: string,
    onProgress: (percent: number) => void,
    signal?: AbortSignal,
  ) =>
    (
      await http.put<{ id: number; key: string; url: string }>(
        "/api/upload",
        file,
        {
          signal,
          params: { name: file.name, folder },
          headers: { "Content-Type": file.type || "application/octet-stream" },
          onUploadProgress: (e) => {
            if (e.total) onProgress(Math.round((e.loaded / e.total) * 100));
          },
        },
      )
    ).data,

  folders: async () =>
    (await http.get<{ folders: string[] }>("/api/folders")).data.folders,

  createFolder: async (path: string) =>
    (await http.post<{ path: string }>("/api/folder", { path })).data,

  removeFolder: async (path: string) =>
    (await http.delete<Job>("/api/folder", { params: { path } })).data,

  thumbnail: async (
    id: number,
    blob: Blob,
    width: number,
    height: number,
    signal?: AbortSignal,
  ) =>
    http.put("/api/thumbnail", blob, {
      params: { id, width, height },
      signal,
      headers: { "Content-Type": "image/webp" },
    }),
  pendingThumbnails: async (after: number, signal?: AbortSignal) =>
    (
      await http.get<{
        files: Pick<FileInfo, "id" | "key" | "name">[];
        next: number | null;
      }>("/api/thumbnails/pending", { params: { after }, signal })
    ).data,
  jobs: async () =>
    (await http.get<{ jobs: Job[]; cleanupPending: number }>("/api/jobs")).data,
  retryJob: async (id: string) =>
    (await http.post<Job>(`/api/jobs/${id}/retry`)).data,
  scan: async () => (await http.post<Job>("/api/repair")).data,
  findings: async (id: string, after = 0) =>
    (
      await http.get<{ findings: Finding[]; next: number | null }>(
        `/api/repair/${id}`,
        { params: { after } },
      )
    ).data,
  importFinding: async (id: number) => http.post("/api/repair/import", { id }),

  createShare: async (
    id: number,
    options: { hours?: number | null; password?: string | null },
  ) =>
    (
      await http.post<{ url: string; exp: number | null }>("/api/share", {
        id,
        ...options,
      })
    ).data,

  shares: async () =>
    (await http.get<{ shares: ShareInfo[] }>("/api/shares")).data.shares,

  removeShare: async (token: string) => {
    await http.delete("/api/share", { params: { token } });
  },
};

export const fileUrl = (key: string) => `/f/${encodeURI(key)}`;
export const shareUrl = (token: string) => `/s/${token}`;
export const absoluteUrl = (path: string) => location.origin + path;

export const thumbnailUrl = (key: string) => `/t/${encodeURIComponent(key)}`;
export interface Job {
  id: string;
  kind: "delete-folder" | "repair";
  path: string;
  status: "running" | "done" | "error";
  phase: string;
  processed: number;
  total: number;
  error: string | null;
  updatedAt: number;
}
export interface Finding {
  id: number;
  key: string;
  kind: "missing" | "unindexed";
  name: string;
  folder: string;
  resolved: number;
}
