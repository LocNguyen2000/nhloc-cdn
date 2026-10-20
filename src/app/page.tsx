"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type Asset = {
  id: string;
  path: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
};

type UploadedAsset = {
  id: string;
  path: string;
  url: string;
  cdnUrl: string;
};

function formatBytes(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(date: string | null) {
  if (!date) return "—";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(parsed);
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

async function fetchAssets(): Promise<Asset[]> {
  const response = await fetch("/api/assets", { cache: "no-store" });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(getErrorMessage(payload, "Không thể tải danh sách tệp."));
  if (!Array.isArray(payload)) throw new Error("Phản hồi từ API không hợp lệ.");
  return payload as Asset[];
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [assetPath, setAssetPath] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAssets(await fetchAssets());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải danh sách tệp.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitialAssets() {
      try {
        const initialAssets = await fetchAssets();
        if (!cancelled) setAssets(initialAssets);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Không thể tải danh sách tệp.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchInitialAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseFile(file: File | undefined) {
    if (!file) return;
    setSelectedFile(file);
    setAssetPath(file.name);
    setError("");
    setNotice("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  }

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || !assetPath.trim()) {
      setError("Chọn tệp và nhập đường dẫn CDN trước khi tải lên.");
      return;
    }

    setUploading(true);
    setError("");
    setNotice("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("path", assetPath.trim().replace(/^\/+/, ""));

      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, "Tải tệp lên thất bại."));

      const uploaded = payload as UploadedAsset;
      setNotice(`Đã tải lên ${uploaded.path}`);
      setSelectedFile(null);
      setAssetPath("");
      if (inputRef.current) inputRef.current.value = "";
      await loadAssets();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Tải tệp lên thất bại.");
    } finally {
      setUploading(false);
    }
  }

  async function copyCdnUrl(path: string) {
    const url = `${window.location.origin}/cdn/${encodeURIComponent(path)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Đã sao chép liên kết CDN.");
      setError("");
    } catch {
      setError("Không thể truy cập clipboard. Hãy mở tệp để sao chép URL.");
      setNotice("");
    }
  }

  const filteredAssets = assets.filter((asset) =>
    `${asset.filename} ${asset.path} ${asset.mime_type ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const totalBytes = assets.reduce((total, asset) => total + (asset.size_bytes ?? 0), 0);

  return (
    <main className={styles.shell}>
      <section className={styles.mainPanel}>
        <header className={styles.topbar}>
          <Link className={styles.brand} href="/" aria-label="Trang chủ Tai gau CDN">
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" />
                <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" />
              </svg>
            </span>
          </Link>
        </header>

        <div className={styles.content}>
          <section className={styles.pageIntro}>
            <div>
              <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                <a href="#assets">Buckets</a>
                <span aria-hidden="true">/</span>
                <strong>cdn-assets</strong>
              </nav>
              <h1>cdn-assets</h1>
              <p>Bucket · Quản lý và tải lên các đối tượng CDN.</p>
            </div>
            <a className={styles.docsLink} href="#upload">
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 12V3m0 0L5.5 6.5M9 3l3.5 3.5M3 11.5v2A1.5 1.5 0 0 0 4.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-2" />
              </svg>
              Tải tệp lên
            </a>
          </section>

          <section className={styles.statsGrid} aria-label="Thống kê tệp">
            <article className={styles.statCard}>
              <span className={styles.statIcon}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13v10h-13zM6 5.5V4h8v1.5M7 9h6M7 12h3" /></svg>
              </span>
              <div><span className={styles.statLabel}>Đối tượng</span><strong>{assets.length}</strong></div>
            </article>
            <article className={styles.statCard}>
              <span className={`${styles.statIcon} ${styles.statIconGreen}`}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14m0-14L6 7m4-4 4 4M4 12.5v3A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-3" /></svg>
              </span>
              <div><span className={styles.statLabel}>Tổng dung lượng</span><strong>{formatBytes(totalBytes)}</strong></div>
            </article>
          </section>

          <section className={styles.uploadSection} id="upload">
            <div className={styles.sectionHeading}>
              <h2>Tải lên</h2>
            </div>
            <form onSubmit={uploadFile}>
              <div
                className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""} ${selectedFile ? styles.dropzoneSelected : ""}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={inputRef}
                  className={styles.fileInput}
                  type="file"
                  onChange={handleFileChange}
                  aria-label="Chọn tệp để tải lên"
                />
                <span className={styles.uploadIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
                </span>
                {selectedFile ? (
                  <div className={styles.selectedFile}>
                    <strong>{selectedFile.name}</strong>
                    <span>{formatBytes(selectedFile.size)}</span>
                  </div>
                ) : (
                  <div className={styles.dropCopy}>
                    <strong>Thả tệp vào đây hoặc <button type="button" onClick={() => inputRef.current?.click()}>chọn tệp</button></strong>
                  </div>
                )}
                {selectedFile && (
                  <button
                    className={styles.changeFile}
                    type="button"
                    onClick={() => inputRef.current?.click()}
                  >
                    Thay đổi
                  </button>
                )}
              </div>
              <div className={styles.uploadControls}>
                <label className={styles.pathField}>
                  <span>Đường dẫn CDN</span>
                  <span className={styles.pathInputWrap}>
                    <span className={styles.pathPrefix}>/cdn/</span>
                    <input
                      value={assetPath}
                      onChange={(event) => setAssetPath(event.target.value)}
                      placeholder="images/your-file.png"
                      aria-label="Đường dẫn CDN"
                    />
                  </span>
                </label>
                <button className={styles.uploadButton} type="submit" disabled={uploading || !selectedFile}>
                  {uploading ? (
                    <><span className={styles.spinner} /> Đang tải lên…</>
                  ) : (
                    <>
                      Tải tệp lên
                      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9h11m-4-4 4 4-4 4" /></svg>
                    </>
                  )}
                </button>
              </div>
            </form>
            {error && <p className={styles.alertError} role="alert">{error}</p>}
            {notice && <p className={styles.alertSuccess} role="status">{notice}</p>}
          </section>

          <section className={styles.assetsSection} id="assets">
            <div className={styles.assetHeading}>
              <div>
                <h2>Đối tượng <span>{assets.length}</span></h2>
              </div>
              <div className={styles.assetActions}>
                <label className={styles.searchBox}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.8" /><path d="m13.2 13.2 4 4" /></svg>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Tìm tệp"
                    aria-label="Tìm tệp"
                  />
                  <kbd>/</kbd>
                </label>
                <button
                  className={styles.assetRefresh}
                  type="button"
                  onClick={() => void loadAssets()}
                  disabled={loading}
                >
                  <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M14.5 6A6 6 0 0 0 4 4.5L3 6m0 0V3m0 3h3m-2.5 6A6 6 0 0 0 14 13.5l1-1m0 0v3m0-3h-3" /></svg>
                  Làm mới
                </button>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.assetTable}>
                <thead>
                  <tr>
                    <th>TÊN</th>
                    <th>KHÓA ĐỐI TƯỢNG</th>
                    <th>KÍCH THƯỚC</th>
                    <th>NGÀY SỬA ĐỔI</th>
                    <th><span className={styles.srOnly}>Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className={styles.emptyState}>Đang tải…</td></tr>
                  ) : filteredAssets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={styles.emptyState}>
                        <strong>{search ? "Không tìm thấy tệp" : "Chưa có tệp"}</strong>
                      </td>
                    </tr>
                  ) : (
                    filteredAssets.map((asset) => (
                      <tr key={asset.id}>
                        <td>
                          <div className={styles.fileCell}>
                            <span className={styles.fileIcon} aria-hidden="true">
                              {asset.mime_type?.startsWith("image/") ? (
                                <svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="2" /><circle cx="7.5" cy="7.5" r="1.5" /><path d="m4 15 4-4 2 2 2-2 4 4" /></svg>
                              ) : (
                                <svg viewBox="0 0 20 20"><path d="M5 2.5h6l4 4v11H5zM11 2.5v4h4M7.5 11h5M7.5 14h5" /></svg>
                              )}
                            </span>
                            <span className={styles.fileNameWrap}>
                              <strong title={asset.filename}>{asset.filename}</strong>
                              <span>{asset.mime_type || "Không rõ loại tệp"}</span>
                            </span>
                          </div>
                        </td>
                        <td><code className={styles.assetPath}>/{asset.path}</code></td>
                        <td className={styles.mutedCell}>{formatBytes(asset.size_bytes)}</td>
                        <td className={styles.mutedCell}>{formatDate(asset.created_at)}</td>
                        <td className={styles.actionCell}>
                          <button className={styles.copyButton} type="button" onClick={() => void copyCdnUrl(asset.path)} aria-label={`Sao chép liên kết CDN của ${asset.filename}`} title="Sao chép liên kết CDN">
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h6A1.5 1.5 0 0 1 17 4.5v8a1.5 1.5 0 0 1-1.5 1.5H14M11 6H5.5A1.5 1.5 0 0 0 4 7.5v8A1.5 1.5 0 0 0 5.5 17h6a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 11.5 6H11Z" /></svg>
                          </button>
                          <a className={styles.openButton} href={`/cdn/${encodeURIComponent(asset.path)}`} target="_blank" rel="noreferrer" aria-label={`Mở ${asset.filename} từ CDN`} title="Mở tệp CDN">
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5m0-5-7 7" /><path d="M14 11v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H9" /></svg>
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
