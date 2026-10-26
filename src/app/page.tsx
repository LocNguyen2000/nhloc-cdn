"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import JSZip from "jszip";
import english from "@/locales/en.json";
import vietnamese from "@/locales/vi.json";
import styles from "./page.module.css";

type Language = "vi" | "en";
type AssetTypeFilter = "all" | "images" | "videos";

const languageStorageKey = "nhloc-cdn-language";
const languageChangeEvent = "nhloc-cdn-language-change";

function subscribeToLanguage(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(languageChangeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(languageChangeEvent, callback);
  };
}

function getSavedLanguage(): Language {
  return window.localStorage.getItem(languageStorageKey) === "en" ? "en" : "vi";
}

function getServerLanguage(): Language {
  return "vi";
}

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

type ConvertedImage = {
  file: File;
  url: string;
  originalSize: number;
};

const formatterDatabaseName = "nhloc-cdn-image-formatter";
const formatterStoreName = "images";
const formatterFilesKey = "selected";

function openFormatterDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(formatterDatabaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(formatterStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Không thể mở bộ nhớ ảnh."));
    request.onblocked = () => reject(new Error("Bộ nhớ ảnh đang bị chặn bởi một thẻ trình duyệt khác."));
  });
}

async function getPersistedImages(): Promise<File[]> {
  const database = await openFormatterDatabase();
  try {
    const images = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(formatterStoreName, "readonly");
      const request = transaction.objectStore(formatterStoreName).get(formatterFilesKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Không thể khôi phục ảnh đã chọn."));
    });
    if (images === undefined) return [];
    if (!Array.isArray(images) || images.some((image) => !(image instanceof File))) {
      throw new Error("Dữ liệu ảnh đã lưu trong trình duyệt không hợp lệ.");
    }
    return images;
  } finally {
    database.close();
  }
}

async function persistImages(images: File[]): Promise<void> {
  const database = await openFormatterDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(formatterStoreName, "readwrite");
      transaction.objectStore(formatterStoreName).put(images, formatterFilesKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Không thể lưu ảnh trong trình duyệt."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Không thể lưu ảnh trong trình duyệt."));
    });
  } finally {
    database.close();
  }
}

function formatBytes(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(date: string | null, language: Language) {
  if (!date) return "—";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
        dateStyle: "medium",
      }).format(parsed);
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

async function fetchAssets(errorMessage: string, invalidResponseMessage: string): Promise<Asset[]> {
  const response = await fetch("/api/assets", { cache: "no-store" });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(getErrorMessage(payload, errorMessage));
  if (!Array.isArray(payload)) throw new Error(invalidResponseMessage);
  return payload as Asset[];
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageFilesRef = useRef<File[]>([]);
  const language = useSyncExternalStore(
    subscribeToLanguage,
    getSavedLanguage,
    getServerLanguage,
  );
  const [activeTab, setActiveTab] = useState<"cdn" | "formatter">("cdn");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [bulkUploadMode, setBulkUploadMode] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageStorageReady, setImageStorageReady] = useState(false);
  const [convertedImages, setConvertedImages] = useState<ConvertedImage[]>([]);
  const [imageQuality, setImageQuality] = useState(0.8);
  const [imageScale, setImageScale] = useState(100);
  const [convertingImage, setConvertingImage] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [imageError, setImageError] = useState("");
  const [assetPath, setAssetPath] = useState("");
  const [search, setSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetTypeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const translations = language === "vi" ? vietnamese : english;
  function t(
    key: keyof typeof vietnamese,
    values: Record<string, string | number> = {},
  ) {
    return Object.entries(values).reduce(
      (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
      translations[key],
    );
  }

  function changeLanguage(nextLanguage: Language) {
    window.localStorage.setItem(languageStorageKey, nextLanguage);
    window.dispatchEvent(new Event(languageChangeEvent));
  }

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    return () => {
      convertedImages.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, [convertedImages]);

  useEffect(() => {
    let cancelled = false;

    async function restoreImages() {
      try {
        const storedImages = await getPersistedImages();
        if (cancelled) return;
        imageFilesRef.current = storedImages;
        setImageFiles(storedImages);
      } catch {
        if (!cancelled) {
          setImageError(translations.errorRestoreImages);
        }
      } finally {
        if (!cancelled) setImageStorageReady(true);
      }
    }

    void restoreImages();
    return () => {
      cancelled = true;
    };
  }, [translations]);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAssets(await fetchAssets(translations.errorLoadAssets, translations.invalidApiResponse));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : translations.errorLoadAssets);
    } finally {
      setLoading(false);
    }
  }, [translations]);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitialAssets() {
      try {
        const initialAssets = await fetchAssets(
          translations.errorLoadAssets,
          translations.invalidApiResponse,
        );
        if (!cancelled) setAssets(initialAssets);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : translations.errorLoadAssets);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchInitialAssets();
    return () => {
      cancelled = true;
    };
  }, [translations]);

  function chooseFiles(files: File[]) {
    if (files.length === 0) return;
    const knownFiles = new Set(
      selectedFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
    );
    const newFiles = files.filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (knownFiles.has(key)) return false;
      knownFiles.add(key);
      return true;
    });
    if (newFiles.length === 0) return;

    if (selectedFiles.length === 0) {
      const isBulk = newFiles.length > 1;
      setBulkUploadMode(isBulk);
      setAssetPath(isBulk ? crypto.randomUUID() : newFiles[0].name);
    } else if (!bulkUploadMode && selectedFiles.length + newFiles.length > 1) {
      setBulkUploadMode(true);
      setAssetPath(crypto.randomUUID());
    }
    setSelectedFiles((currentFiles) => [...currentFiles, ...newFiles]);
    setError("");
    setNotice("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFiles(Array.from(event.dataTransfer.files));
  }

  function removeSelectedFile(index: number) {
    const remainingFiles = selectedFiles.filter((_, fileIndex) => fileIndex !== index);
    setSelectedFiles(remainingFiles);
    if (remainingFiles.length === 0) {
      setBulkUploadMode(false);
      setAssetPath("");
    } else if (remainingFiles.length === 1 && !bulkUploadMode) {
      setAssetPath(remainingFiles[0].name);
    }
  }

  async function chooseImages(files: File[]) {
    if (files.length === 0 || !imageStorageReady) return;

    const supportedFiles = files.filter(
      (file) =>
        ["image/png", "image/jpeg"].includes(file.type) || /\.(png|jpe?g)$/i.test(file.name),
    );
    const unsupportedCount = files.length - supportedFiles.length;
    const existingFileKeys = new Set(
      imageFilesRef.current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
    );
    const newFiles = supportedFiles.filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (existingFileKeys.has(key)) return false;
      existingFileKeys.add(key);
      return true;
    });

    if (newFiles.length > 0) {
      const nextFiles = [...imageFilesRef.current, ...newFiles];
      imageFilesRef.current = nextFiles;
      setImageFiles(nextFiles);
      setConvertedImages([]);
      try {
        await persistImages(nextFiles);
      } catch {
        setImageError(t("errorPersistImages"));
        return;
      }
    }
    setImageError(
      unsupportedCount > 0
        ? t("skippedUnsupportedImages", { count: unsupportedCount })
        : "",
    );
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    void chooseImages(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingImages(false);
    void chooseImages(Array.from(event.dataTransfer.files));
  }

  async function removeImage(index: number) {
    const nextFiles = imageFilesRef.current.filter((_, fileIndex) => fileIndex !== index);
    imageFilesRef.current = nextFiles;
    setImageFiles(nextFiles);
    setConvertedImages([]);
    try {
      await persistImages(nextFiles);
      setImageError("");
    } catch {
      setImageError(t("errorUpdateImageStorage"));
    }
  }

  async function convertImageFile(imageFile: File): Promise<File> {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(imageFile);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * imageScale / 100));
      canvas.height = Math.max(1, Math.round(bitmap.height * imageScale / 100));
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("errorProcessImage"));
      context.drawImage(bitmap, 0, 0);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error(t("errorCreateWebp")));
          },
          "image/webp",
          imageQuality,
        );
      });
      if (blob.type !== "image/webp") {
        throw new Error(t("errorWebpUnsupported"));
      }

      const outputName = imageFile.name.replace(/\.[^.]+$/, "") + ".webp";
      return new File([blob], outputName, { type: "image/webp" });
    } finally {
      bitmap?.close();
    }
  }

  async function convertImages() {
    if (imageFiles.length === 0) return;
    setConvertingImage(true);
    setImageError("");

    try {
      const usedNames = new Set<string>();
      const outputs: ConvertedImage[] = [];
      const failures: string[] = [];

      for (const imageFile of imageFiles) {
        try {
          const file = await convertImageFile(imageFile);
          const extensionIndex = file.name.lastIndexOf(".");
          const baseName = file.name.slice(0, extensionIndex);
          let uniqueName = file.name;
          let suffix = 2;
          while (usedNames.has(uniqueName.toLocaleLowerCase())) {
            uniqueName = `${baseName}-${suffix}.webp`;
            suffix += 1;
          }
          usedNames.add(uniqueName.toLocaleLowerCase());

          const uniqueFile =
            uniqueName === file.name ? file : new File([file], uniqueName, { type: file.type });
          outputs.push({
            file: uniqueFile,
            url: URL.createObjectURL(uniqueFile),
            originalSize: imageFile.size,
          });
        } catch (conversionError) {
          failures.push(
            `${imageFile.name}: ${
              conversionError instanceof Error ? conversionError.message : t("errorCreateWebp")
            }`,
          );
        }
      }

      setConvertedImages(outputs);
      if (failures.length > 0) {
        setImageError(
          t("errorConvertImages", { count: failures.length, errors: failures.join(" ") }),
        );
      } else if (outputs.length === 0) {
        setImageError(t("errorNoConvertedImages"));
      }
    } finally {
      setConvertingImage(false);
    }
  }

  async function downloadConvertedZip() {
    if (convertedImages.length === 0) return;

    setDownloadingZip(true);
    setImageError("");
    try {
      const zip = new JSZip();
      convertedImages.forEach(({ file }) => zip.file(file.name, file));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = convertedImages.length === 1
        ? convertedImages[0].file.name.replace(/\.webp$/i, "") + ".zip"
        : "webp-images.zip";
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (downloadError) {
      setImageError(
        downloadError instanceof Error
          ? downloadError.message
          : t("errorCreateZip"),
      );
    } finally {
      setDownloadingZip(false);
    }
  }

  async function uploadFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      setError(t("errorChooseUploadFiles"));
      return;
    }

    const isBulkUpload = bulkUploadMode || selectedFiles.length > 1;
    const destination = assetPath.trim().replace(/^\/+|\/+$/g, "");
    if (isBulkUpload && !destination) {
      setError(t("errorFolderRequired"));
      setNotice("");
      return;
    }
    const paths = selectedFiles.map((file) => {
      if (isBulkUpload) return [destination, file.name].filter(Boolean).join("/");
      return destination || file.name;
    });
    const uniquePaths = new Set(paths.map((path) => path.toLocaleLowerCase()));
    if (uniquePaths.size !== paths.length) {
      setError(t("errorDuplicateNames"));
      setNotice("");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadTotal(selectedFiles.length);
    setError("");
    setNotice("");
    const uploadedFiles = new Set<File>();
    const failedUploads: string[] = [];

    try {
      for (const [index, file] of selectedFiles.entries()) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("path", paths[index]);

          const response = await fetch("/api/upload", { method: "POST", body: formData });
          const payload: unknown = await response.json();
          if (!response.ok) {
            throw new Error(getErrorMessage(payload, t("errorUploadFile")));
          }

          const uploaded = payload as UploadedAsset;
          uploadedFiles.add(file);
          setNotice((currentNotice) =>
            currentNotice
              ? `${currentNotice}\n${uploaded.path}`
              : t("uploadSuccess", { path: uploaded.path }),
          );
        } catch (uploadError) {
          failedUploads.push(
            `${file.name}: ${
              uploadError instanceof Error ? uploadError.message : t("errorUploadFile")
            }`,
          );
        } finally {
          setUploadProgress(index + 1);
        }
      }

      if (uploadedFiles.size > 0) {
        const remainingFiles = selectedFiles.filter((file) => !uploadedFiles.has(file));
        setSelectedFiles(remainingFiles);
        if (remainingFiles.length === 0) {
          setAssetPath("");
          setBulkUploadMode(false);
          if (inputRef.current) inputRef.current.value = "";
        }
        await loadAssets();
      }
      if (failedUploads.length > 0) {
        setError(t("errorUploadFiles", { count: failedUploads.length, errors: failedUploads.join("\n") }));
      }
    } finally {
      setUploading(false);
    }
  }

  async function copyCdnUrl(path: string) {
    const url = `${window.location.origin}/cdn/${encodeURIComponent(path)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t("copiedCdnUrl"));
      setError("");
    } catch {
      setError(t("clipboardError"));
      setNotice("");
    }
  }

  async function deleteAssets(ids: string[]) {
    if (ids.length === 0) return;
    const prompt = ids.length === 1
      ? t("confirmDeleteOne")
      : t("confirmDeleteMany", { count: ids.length });
    if (!window.confirm(prompt)) return;

    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, t("errorDeleteAssets")));

      setAssets((currentAssets) => currentAssets.filter((asset) => !ids.includes(asset.id)));
      setSelectedAssetIds((currentIds) => {
        const remainingIds = new Set(currentIds);
        ids.forEach((id) => remainingIds.delete(id));
        return remainingIds;
      });
      setNotice(ids.length === 1 ? t("deletedOne") : t("deletedMany", { count: ids.length }));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("confirmDeleteAssetsFallback"));
    } finally {
      setDeleting(false);
    }
  }

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch = `${asset.filename} ${asset.path} ${asset.mime_type ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
    const mimeType = asset.mime_type?.toLowerCase() ?? "";
    const matchesType =
      assetTypeFilter === "all" ||
      (assetTypeFilter === "images" && mimeType.startsWith("image/")) ||
      (assetTypeFilter === "videos" && mimeType.startsWith("video/"));
    return matchesSearch && matchesType;
  });
  const allVisibleAssetsSelected =
    filteredAssets.length > 0 && filteredAssets.every((asset) => selectedAssetIds.has(asset.id));
  const someVisibleAssetsSelected =
    filteredAssets.some((asset) => selectedAssetIds.has(asset.id)) && !allVisibleAssetsSelected;
  const totalBytes = assets.reduce((total, asset) => total + (asset.size_bytes ?? 0), 0);

  return (
    <main className={styles.shell}>
      <section className={styles.mainPanel}>
        <header className={styles.topbar}>
          <Link className={styles.brand} href="/" aria-label={t("homeLabel")}>
            <span className={styles.brandMark} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" />
                <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" />
              </svg>
            </span>
          </Link>
          <div className={styles.languageSwitch} role="group" aria-label={t("languageLabel")}>
            <button
              type="button"
              aria-pressed={language === "vi"}
              onClick={() => changeLanguage("vi")}
            >
              {t("vietnamese")}
            </button>
            <button
              type="button"
              aria-pressed={language === "en"}
              onClick={() => changeLanguage("en")}
            >
              {t("english")}
            </button>
          </div>
        </header>

        <div className={styles.content}>
          <nav className={styles.viewTabs} aria-label={t("toolsLabel")}>
            <button
              className={activeTab === "cdn" ? styles.viewTabActive : styles.viewTab}
              type="button"
              aria-pressed={activeTab === "cdn"}
              onClick={() => setActiveTab("cdn")}
            >
              {t("cdnTab")}
            </button>
            <button
              className={activeTab === "formatter" ? styles.viewTabActive : styles.viewTab}
              type="button"
              aria-pressed={activeTab === "formatter"}
              onClick={() => setActiveTab("formatter")}
            >
              {t("formatterTab")}
            </button>
          </nav>

          {activeTab === "cdn" && (
            <div id="cdn-panel" className={styles.tabPanel}>
          <section className={styles.pageIntro}>
            <div>
              <nav className={styles.breadcrumb} aria-label={t("breadcrumbLabel")}>
                <a href="#assets">{t("buckets")}</a>
                <span aria-hidden="true">/</span>
                <strong>cdn-assets</strong>
              </nav>
              <h1>cdn-assets</h1>
              <p>{t("bucketDescription")}</p>
            </div>
            <a className={styles.docsLink} href="#upload">
              <svg viewBox="0 0 18 18" aria-hidden="true">
                <path d="M9 12V3m0 0L5.5 6.5M9 3l3.5 3.5M3 11.5v2A1.5 1.5 0 0 0 4.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-2" />
              </svg>
              {t("uploadFile")}
            </a>
          </section>
          <section className={styles.statsGrid} aria-label={t("statsLabel")}>
            <article className={styles.statCard}>
              <span className={styles.statIcon}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13v10h-13zM6 5.5V4h8v1.5M7 9h6M7 12h3" /></svg>
              </span>
              <div><span className={styles.statLabel}>{t("objects")}</span><strong>{assets.length}</strong></div>
            </article>
            <article className={styles.statCard}>
              <span className={`${styles.statIcon} ${styles.statIconGreen}`}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14m0-14L6 7m4-4 4 4M4 12.5v3A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-3" /></svg>
              </span>
              <div><span className={styles.statLabel}>{t("totalStorage")}</span><strong>{formatBytes(totalBytes)}</strong></div>
            </article>
          </section>

          <section className={styles.uploadSection} id="upload">
            <div className={styles.sectionHeading}>
              <h2>{t("upload")}</h2>
            </div>
            <form onSubmit={uploadFile}>
              <div
                className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""} ${selectedFiles.length > 0 ? styles.dropzoneSelected : ""}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={inputRef}
                  className={styles.fileInput}
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  disabled={uploading}
                  aria-label={t("chooseUploadFiles")}
                />
                <span className={styles.uploadIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
                </span>
                {selectedFiles.length > 0 ? (
                  <div className={styles.selectedFile} aria-live="polite">
                    <strong>
                      {t("selectedFiles", { count: selectedFiles.length })}
                    </strong>
                    <span>
                      {formatBytes(selectedFiles.reduce((total, file) => total + file.size, 0))}
                      {" · "}{t("totalFilesSize")}
                    </span>
                  </div>
                ) : (
                  <div className={styles.dropCopy}>
                    <strong>{t("dropFiles")} <button type="button" onClick={() => inputRef.current?.click()}>{t("chooseFiles")}</button></strong>
                    <span>{t("multipleFilesHint")}</span>
                  </div>
                )}
                {selectedFiles.length > 0 && (
                  <button
                    className={styles.changeFile}
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                  >
                    {t("addFiles")}
                  </button>
                )}
              </div>
              {selectedFiles.length > 0 && (
                <ul className={styles.uploadFileList} aria-label={t("pendingUploads")}>
                  {selectedFiles.map((file, index) => (
                    <li key={`${file.name}:${file.size}:${file.lastModified}:${index}`}>
                      <span title={file.name}>{file.name}</span>
                      <span>{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(index)}
                        disabled={uploading}
                        aria-label={t("removeFile", { name: file.name })}
                      >
                        {t("remove")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.uploadControls}>
                <label className={styles.pathField}>
                  <span>{bulkUploadMode ? t("destinationFolder") : t("cdnPath")}</span>
                  <span className={styles.pathInputWrap}>
                    <span className={styles.pathPrefix}>/cdn/</span>
                    <input
                      value={assetPath}
                      onChange={(event) => setAssetPath(event.target.value)}
                      placeholder={bulkUploadMode ? t("destinationFolderPlaceholder") : t("filePathPlaceholder")}
                      aria-label={bulkUploadMode ? t("destinationFolder") : t("cdnPath")}
                      disabled={uploading}
                      title={bulkUploadMode ? t("uuidFolderHint") : undefined}
                    />
                  </span>
                  {bulkUploadMode && (
                    <span className={styles.folderHint}>{t("uuidFolderHint")}</span>
                  )}
                </label>
                <button className={styles.uploadButton} type="submit" disabled={uploading || selectedFiles.length === 0}>
                  {uploading ? (
                    <><span className={styles.spinner} /> {t("uploadingProgress", { progress: uploadProgress, total: uploadTotal })}</>
                  ) : (
                    <>
                      {selectedFiles.length > 1
                        ? t("uploadFiles", { count: selectedFiles.length })
                        : t("uploadFile")}
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
                <h2>{t("objects")} <span>{assets.length}</span></h2>
              </div>
              <div className={styles.assetActions}>
                {selectedAssetIds.size > 0 && (
                  <button
                    className={styles.deleteSelectedButton}
                    type="button"
                    onClick={() => void deleteAssets([...selectedAssetIds])}
                    disabled={deleting || loading}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12m-10 0 .7 11h6.6L14 6M8 6V4h4v2m-3 3v5m2-5v5" /></svg>
                    {t("deleteSelected", { count: selectedAssetIds.size })}
                  </button>
                )}
                <label className={styles.assetTypeFilter}>
                  <span>{t("filterType")}</span>
                  <select
                    value={assetTypeFilter}
                    onChange={(event) => setAssetTypeFilter(event.target.value as AssetTypeFilter)}
                    aria-label={t("filterType")}
                  >
                    <option value="all">{t("allFiles")}</option>
                    <option value="images">{t("images")}</option>
                    <option value="videos">{t("videos")}</option>
                  </select>
                </label>
                <label className={styles.searchBox}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.8" /><path d="m13.2 13.2 4 4" /></svg>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("searchFiles")}
                    aria-label={t("searchFiles")}
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
                  {t("refresh")}
                </button>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.assetTable}>
                <thead>
                  <tr>
                    <th className={styles.selectionColumn}>
                      <input
                        type="checkbox"
                        checked={allVisibleAssetsSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someVisibleAssetsSelected;
                        }}
                        onChange={(event) => {
                          const selectVisible = event.target.checked;
                          setSelectedAssetIds((currentIds) => {
                            const nextIds = new Set(currentIds);
                            filteredAssets.forEach((asset) => {
                              if (selectVisible) nextIds.add(asset.id);
                              else nextIds.delete(asset.id);
                            });
                            return nextIds;
                          });
                        }}
                        disabled={loading || deleting || filteredAssets.length === 0}
                        aria-label={t("selectAllVisible")}
                      />
                    </th>
                    <th>{t("nameColumn")}</th>
                    <th>{t("objectKeyColumn")}</th>
                    <th>{t("sizeColumn")}</th>
                    <th>{t("modifiedColumn")}</th>
                    <th><span className={styles.srOnly}>{t("actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className={styles.emptyState}>{t("loading")}</td></tr>
                  ) : filteredAssets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={styles.emptyState}>
                        <strong>
                          {search.trim() || assetTypeFilter !== "all" || assets.length > 0
                            ? t("noSearchResults")
                            : t("noFiles")}
                        </strong>
                      </td>
                    </tr>
                  ) : (
                    filteredAssets.map((asset) => (
                      <tr key={asset.id} className={selectedAssetIds.has(asset.id) ? styles.selectedRow : undefined}>
                        <td className={styles.selectionColumn}>
                          <input
                            type="checkbox"
                            checked={selectedAssetIds.has(asset.id)}
                            onChange={(event) => {
                              const selected = event.target.checked;
                              setSelectedAssetIds((currentIds) => {
                                const nextIds = new Set(currentIds);
                                if (selected) nextIds.add(asset.id);
                                else nextIds.delete(asset.id);
                                return nextIds;
                              });
                            }}
                            disabled={deleting}
                            aria-label={t("selectFile", { name: asset.filename })}
                          />
                        </td>
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
                              <span>{asset.mime_type || t("unknownFileType")}</span>
                            </span>
                          </div>
                        </td>
                        <td><code className={styles.assetPath}>/{asset.path}</code></td>
                        <td className={styles.mutedCell}>{formatBytes(asset.size_bytes)}</td>
                        <td className={styles.mutedCell}>{formatDate(asset.created_at, language)}</td>
                        <td className={styles.actionCell}>
                          <button className={styles.copyButton} type="button" onClick={() => void copyCdnUrl(asset.path)} aria-label={t("copyCdnUrl", { name: asset.filename })} title={t("copyCdnUrlTitle")}>
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h6A1.5 1.5 0 0 1 17 4.5v8a1.5 1.5 0 0 1-1.5 1.5H14M11 6H5.5A1.5 1.5 0 0 0 4 7.5v8A1.5 1.5 0 0 0 5.5 17h6a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 11.5 6H11Z" /></svg>
                          </button>
                          <a className={styles.openButton} href={`/cdn/${encodeURIComponent(asset.path)}`} target="_blank" rel="noreferrer" aria-label={t("openCdnFile", { name: asset.filename })} title={t("openCdnFileTitle")}>
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5m0-5-7 7" /><path d="M14 11v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H9" /></svg>
                          </a>
                          <button
                            className={styles.deleteButton}
                            type="button"
                            onClick={() => void deleteAssets([asset.id])}
                            disabled={deleting}
                            aria-label={t("deleteFile", { name: asset.filename })}
                            title={t("deleteFileTitle")}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12m-10 0 .7 11h6.6L14 6M8 6V4h4v2m-3 3v5m2-5v5" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
            </div>
          )}

          {activeTab === "formatter" && (
            <div id="formatter-panel" className={styles.tabPanel}>
              <section className={styles.pageIntro}>
                <div>
                  <h1>{t("formatterTitle")}</h1>
                  <p>{t("formatterDescription")}</p>
                </div>
              </section>
              <section className={styles.imageFormatter} id="image-formatter">
            <div
              className={`${styles.dropzone} ${styles.formatterDropzone} ${draggingImages ? styles.dropzoneActive : ""} ${imageFiles.length > 0 ? styles.dropzoneSelected : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDraggingImages(true);
              }}
              onDragLeave={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                ) {
                  setDraggingImages(false);
                }
              }}
              onDrop={handleImageDrop}
            >
              <input
                ref={imageInputRef}
                className={styles.fileInput}
                type="file"
                multiple
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                onChange={handleImageChange}
                disabled={convertingImage || !imageStorageReady}
                aria-label={t("imagesTypeHint")}
              />
              <span className={styles.uploadIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
              </span>
              {imageFiles.length > 0 ? (
                <div className={styles.selectedFile}>
                  <strong>{t("selectedImages", { count: imageFiles.length })}</strong>
                  <span>
                    {formatBytes(imageFiles.reduce((total, file) => total + file.size, 0))}
                    {" · "}{t("addImagesHint")}
                  </span>
                </div>
              ) : (
                <div className={styles.dropCopy}>
                  <strong>
                    {imageStorageReady
                      ? <>{t("dropImages")} <button type="button" onClick={() => imageInputRef.current?.click()}>{t("chooseImages")}</button></>
                      : t("imagesRestoreHint")}
                  </strong>
                  <span>
                    {imageStorageReady
                      ? t("imagesStorageHint")
                      : t("imagesTypeHint")}
                  </span>
                </div>
              )}
              {imageFiles.length > 0 && (
                <button
                  className={styles.changeFile}
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={convertingImage || !imageStorageReady}
                >
                  {t("addImages")}
                </button>
              )}
            </div>
            <div className={styles.formatterControls}>
              <label className={styles.qualityControl}>
                <span>{t("quality")} <strong>{Math.round(imageQuality * 100)}%</strong></span>
                <input
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.05"
                  value={imageQuality}
                  disabled={convertingImage}
                  onChange={(event) => {
                    setImageQuality(Number(event.target.value));
                    setConvertedImages([]);
                  }}
                  aria-label={t("imageQualityLabel")}
                />
              </label>
              <label className={styles.qualityControl}>
                <span>{t("imageSize")} <strong>{imageScale}%</strong></span>
                <input
                  type="range"
                  min="25"
                  max="100"
                  step="5"
                  value={imageScale}
                  disabled={convertingImage}
                  onChange={(event) => {
                    setImageScale(Number(event.target.value));
                    setConvertedImages([]);
                  }}
                  aria-label={t("imageSizeLabel")}
                />
              </label>
              <button
                className={styles.uploadButton}
                type="button"
                onClick={() => void convertImages()}
                disabled={imageFiles.length === 0 || convertingImage || !imageStorageReady}
              >
                {convertingImage ? (
                  <><span className={styles.spinner} /> {t("converting")}</>
                ) : (
                  t("convertImages", { count: imageFiles.length })
                )}
              </button>
            </div>
            {imageFiles.length > 0 && (
              <ul className={styles.selectedImageList} aria-label={t("selectedImagesList")}>
                {imageFiles.map((file, index) => (
                  <li key={`${file.name}:${file.size}:${file.lastModified}:${index}`}>
                    <span title={file.name}>{file.name}</span>
                    <span>{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      disabled={convertingImage}
                      aria-label={t("removeFile", { name: file.name })}
                    >
                      {t("remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {imageError && <p className={styles.alertError} role="alert">{imageError}</p>}
            {convertedImages.length > 0 && (
              <div className={styles.convertedSummary} role="status">
                <div className={styles.convertedResults}>
                  {convertedImages.map((convertedImage) => (
                    <div className={styles.convertedResult} key={convertedImage.file.name}>
                      <Image
                        src={convertedImage.url}
                        alt={t("convertedPreview", { name: convertedImage.file.name })}
                        width={56}
                        height={56}
                        unoptimized
                      />
                      <div className={styles.convertedDetails}>
                        <strong>{convertedImage.file.name}</strong>
                        <span>
                          {formatBytes(convertedImage.originalSize)} → {formatBytes(convertedImage.file.size)}
                          {convertedImage.originalSize > 0 && (
                            <span className={convertedImage.file.size <= convertedImage.originalSize ? styles.savings : styles.sizeIncrease}>
                              {convertedImage.file.size <= convertedImage.originalSize
                                ? t("reducedBy", {
                                    percent: Math.round((1 - convertedImage.file.size / convertedImage.originalSize) * 100),
                                  })
                                : t("increasedBy", {
                                    percent: Math.round((convertedImage.file.size / convertedImage.originalSize - 1) * 100),
                                  })}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  className={styles.downloadButton}
                  type="button"
                  onClick={() => void downloadConvertedZip()}
                  disabled={downloadingZip}
                >
                  {downloadingZip
                    ? t("creatingZip")
                    : t("downloadZip", { count: convertedImages.length })}
                </button>
              </div>
            )}
          </section>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
