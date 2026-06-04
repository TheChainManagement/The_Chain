'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import type { ImportableKind, KindSpec } from '@/lib/import/field-specs';
import { autoMap, type ColumnMapping, missingRequired } from '@/lib/import/mapping';
import { type ParsedCsv, parseCsv } from '@/lib/import/parse';
import { mapRows } from '@/lib/import/transform';
import { getImportProgress, type ImportActionResult, runImport } from './actions';
import { ColumnMapper } from './ColumnMapper';
import styles from './import.module.css';
import { PreviewPane } from './PreviewPane';
import { UploadZone } from './UploadZone';

type Step = 'upload' | 'map' | 'preview' | 'running' | 'done';

/** Poll cadence + cap for a durable import (≈8 min before a soft hand-off). */
const POLL_MS = 800;
const POLL_MAX = 600;

/** Where the done screen sends you to see what just landed. */
const DESTINATION: Record<ImportableKind, { href: string; label: string }> = {
  product: { href: '/inventory', label: 'View catalog' },
  supplier: { href: '/suppliers', label: 'View suppliers' },
  stock_movement: { href: '/inventory', label: 'View catalog' },
};

/**
 * ImportFlow — the upload → map → preview → commit state machine (client).
 * Parsing happens here for the live preview; the server re-parses authoritatively
 * at commit, so the client-parsed result is only ever used to draw the pegboard.
 */
export function ImportFlow({ spec }: { spec: KindSpec }): ReactNode {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState<ImportActionResult | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [pending, startTransition] = useTransition();
  // The tracking key of the import currently being polled; a reset clears it so
  // a stale poll can't clobber a fresh run.
  const activeKey = useRef<string | null>(null);

  const handleFile = useCallback(
    (name: string, text: string) => {
      setParseError('');
      try {
        const next = parseCsv(text);
        setFileName(name);
        setCsvText(text);
        setParsed(next);
        setMapping(autoMap(next.headers, spec));
        setStep('map');
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Could not read this file.');
      }
    },
    [spec],
  );

  const stillMissing = useMemo(
    () => (parsed ? missingRequired(spec, mapping) : spec.fields.filter((f) => f.required)),
    [parsed, spec, mapping],
  );

  const validation = useMemo(() => {
    if (!parsed) return null;
    return mapRows(parsed.rows, spec, mapping);
  }, [parsed, spec, mapping]);

  // Poll a durable import until it completes (or a soft cap hands it off).
  const poll = useCallback((trackingKey: string) => {
    activeKey.current = trackingKey;
    let attempts = 0;
    const tick = async () => {
      if (activeKey.current !== trackingKey) return; // superseded by a reset
      attempts += 1;
      const p = await getImportProgress(trackingKey);
      if (activeKey.current !== trackingKey) return;

      if (p.status === 'completed') {
        setProgress(null);
        setResult({ ok: true, summary: p.summary });
        setStep('done');
        return;
      }
      if (p.status === 'failed') {
        setProgress(null);
        setResult({ ok: false, error: p.error });
        setStep('preview');
        return;
      }
      if (p.status === 'running') {
        setProgress({ processed: p.processed, total: p.total });
      }
      if (attempts >= POLL_MAX) {
        setProgress(null);
        setResult({
          ok: false,
          error:
            'This import is still running. It will finish on its own — check back in a moment.',
        });
        setStep('preview');
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    void tick();
  }, []);

  const commit = useCallback(() => {
    const idempotencyKey = crypto.randomUUID();
    startTransition(async () => {
      const res = await runImport({ kind: spec.kind, csvText, mapping, idempotencyKey });
      if (res.ok && 'async' in res) {
        setProgress({ processed: 0, total: 0 });
        setStep('running');
        poll(res.trackingKey);
        return;
      }
      setResult(res);
      if (res.ok) setStep('done');
    });
  }, [csvText, mapping, spec.kind, poll]);

  const reset = useCallback(() => {
    activeKey.current = null; // stop any in-flight poll
    setStep('upload');
    setFileName('');
    setCsvText('');
    setParsed(null);
    setMapping({});
    setResult(null);
    setProgress(null);
    setParseError('');
  }, []);

  return (
    <div className={styles.flow}>
      <Stepper step={step} />

      {step === 'upload' ? (
        <UploadZone blurb={spec.blurb} error={parseError} onFile={handleFile} />
      ) : null}

      {step === 'map' && parsed ? (
        <>
          <ColumnMapper
            spec={spec}
            headers={parsed.headers}
            sampleRow={parsed.rows[0] ?? {}}
            mapping={mapping}
            onChange={setMapping}
          />
          <div className={styles.flowActions}>
            <button type="button" className={styles.backLink} onClick={reset}>
              Choose another file
            </button>
            <ActionButton
              variant="primary"
              disabled={stillMissing.length > 0}
              onClick={() => setStep('preview')}
            >
              {stillMissing.length > 0
                ? `Map ${stillMissing.length} required field${stillMissing.length > 1 ? 's' : ''}`
                : 'Preview import'}
            </ActionButton>
          </div>
        </>
      ) : null}

      {step === 'preview' && parsed && validation ? (
        <>
          <PreviewPane spec={spec} rows={parsed.rows} mapping={mapping} validation={validation} />
          {result && !result.ok ? (
            <p className={styles.commitError} role="alert">
              {result.error}
            </p>
          ) : null}
          <div className={styles.flowActions}>
            <button type="button" className={styles.backLink} onClick={() => setStep('map')}>
              Back to mapping
            </button>
            <ActionButton
              variant="primary"
              loading={pending}
              disabled={validation.payloads.length === 0}
              onClick={commit}
            >
              {validation.payloads.length === 0
                ? 'No valid rows to import'
                : `Import ${validation.payloads.length} ${spec.label.toLowerCase()}`}
            </ActionButton>
          </div>
        </>
      ) : null}

      {step === 'running' ? (
        <Panel prefix="Importing" title={`Bringing in your ${spec.label.toLowerCase()}`}>
          <div className={styles.runningBody}>
            <p className={styles.doneCopy}>
              This is a large file, so it&rsquo;s running durably — it survives interruptions and
              picks up where it left off. You can keep this tab open.
            </p>
            <ProgressBar processed={progress?.processed ?? 0} total={progress?.total ?? 0} />
            <p className={styles.progressLabel}>
              {progress && progress.total > 0
                ? `${progress.processed.toLocaleString()} of ${progress.total.toLocaleString()} rows`
                : 'Preparing…'}
            </p>
          </div>
        </Panel>
      ) : null}

      {step === 'done' && result?.ok && 'summary' in result ? (
        <Panel
          prefix="Imported"
          title={`${result.summary.imported} ${spec.label.toLowerCase()} landed`}
        >
          <div className={styles.doneBody}>
            <p className={styles.doneCopy}>
              {result.summary.imported} row{result.summary.imported === 1 ? '' : 's'} committed from{' '}
              <strong>{fileName}</strong>.
              {result.summary.skipped > 0
                ? ` ${result.summary.skipped} ${result.summary.skipped === 1 ? 'row was' : 'rows were'} already on file and left untouched.`
                : ''}
              {result.summary.failed > 0
                ? ` ${result.summary.failed} ${result.summary.failed === 1 ? 'row was' : 'rows were'} skipped and logged for review.`
                : result.summary.skipped > 0
                  ? ''
                  : ' Every row passed.'}
            </p>
            <div className={styles.doneActions}>
              <Link href={DESTINATION[spec.kind].href} className={pageStyles.cta}>
                {DESTINATION[spec.kind].label}
              </Link>
              <button type="button" className={styles.backLink} onClick={reset}>
                Import another file
              </button>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'map', label: 'Map columns' },
  { key: 'preview', label: 'Preview' },
  { key: 'done', label: 'Done' },
];

function Stepper({ step }: { step: Step }): ReactNode {
  // 'running' is a large-file substep between preview and done — show preview as
  // complete and done as the active target.
  const lookupStep = step === 'running' ? 'done' : step;
  const activeIndex = STEPS.findIndex((s) => s.key === lookupStep);
  return (
    <ol className={styles.stepper} aria-label="Import progress">
      {STEPS.map((s, i) => {
        const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending';
        return (
          <li key={s.key} className={styles.step} data-state={state}>
            <span className={styles.stepDot} aria-hidden="true" />
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

/** The live cobalt fill for a durable import's progress. */
export function ProgressBar({ processed, total }: { processed: number; total: number }): ReactNode {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  return (
    <div
      className={styles.progressTrack}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}
