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

interface ListResult {
  folder: string;
  folders: FolderInfo[];
  files: FileInfo[];
  /** Global stats across the whole library, not just this folder. */
  count: number;
  totalSize: number;
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

  list: async (folder: string) =>
    (await http.get<ListResult>("/api/list", { params: { folder } })).data,

  remove: async (id: number) => {
    await http.delete("/api/file", { params: { id } });
  },

  /** Move and/or rename. Metadata only — the stored object is untouched. */
  move: async (id: number, changes: { folder?: string; name?: string }) =>
    (await http.patch<{ id: number; folder: string; name: string }>(
      "/api/file",
      { id, ...changes }
    )).data,

  upload: async (
    file: File,
    folder: string,
    onProgress: (percent: number) => void
  ) =>
    (
      await http.put<{ id: number; key: string; url: string }>("/api/upload", file, {
        params: { name: file.name, folder },
        headers: { "Content-Type": file.type || "application/octet-stream" },
        onUploadProgress: (e) => {
          if (e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
    ).data,

  folders: async () =>
    (await http.get<{ folders: string[] }>("/api/folders")).data.folders,

  createFolder: async (path: string) =>
    (await http.post<{ path: string }>("/api/folder", { path })).data,

  removeFolder: async (path: string) => {
    await http.delete("/api/folder", { params: { path } });
  },

  createShare: async (
    id: number,
    options: { hours?: number | null; password?: string | null }
  ) =>
    (await http.post<{ url: string; exp: number | null }>("/api/share", { id, ...options }))
      .data,

  shares: async () => (await http.get<{ shares: ShareInfo[] }>("/api/shares")).data.shares,

  removeShare: async (token: string) => {
    await http.delete("/api/share", { params: { token } });
  },
};

export const fileUrl = (key: string) => `/f/${encodeURI(key)}`;
export const shareUrl = (token: string) => `/s/${token}`;
export const absoluteUrl = (path: string) => location.origin + path;
