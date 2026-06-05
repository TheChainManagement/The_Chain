'use client';

import { type DragEvent, type ReactNode, useId, useRef, useState } from 'react';
import { decodeCsvBytes } from '@/lib/import/parse';
import styles from './import.module.css';

/**
 * UploadZone — drag-and-drop (or click) CSV file input. Reads the file as text
 * in the browser and hands it up; nothing is sent to the server until commit.
 */
export function UploadZone({
  blurb,
  error,
  onFile,
}: {
  blurb: string;
  error?: string;
  onFile: (name: string, text: string) => void;
}): ReactNode {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function read(file: File): void {
    const reader = new FileReader();
    // Read bytes (not text) so the encoding is detected here, not assumed UTF-8 —
    // legacy Excel/Windows-1252 exports decode correctly instead of mojibaking.
    reader.onload = () => {
      const buffer = reader.result;
      if (buffer instanceof ArrayBuffer) onFile(file.name, decodeCsvBytes(buffer));
    };
    reader.readAsArrayBuffer(file);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) read(file);
  }

  return (
    <label
      htmlFor={inputId}
      className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <span className={styles.dropMark} aria-hidden="true" />
      <span className={styles.dropTitle}>Drop a CSV here</span>
      <span className={styles.dropBlurb}>{blurb} Or click to choose a file.</span>
      {error ? (
        <span className={styles.dropError} role="alert">
          {error}
        </span>
      ) : null}
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className={styles.fileInput}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) read(file);
        }}
      />
    </label>
  );
}
