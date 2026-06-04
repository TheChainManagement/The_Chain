'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useMemo, useState, useTransition } from 'react';
import { ActionButton } from '@/components/ActionButton/ActionButton';
import pageStyles from '@/components/bench/page.module.css';
import { Panel } from '@/components/Panel/Panel';
import type { ImportableKind, KindSpec } from '@/lib/import/field-specs';
import { autoMap, type ColumnMapping, missingRequired } from '@/lib/import/mapping';
import { type ParsedCsv, parseCsv } from '@/lib/import/parse';
import { mapRows } from '@/lib/import/transform';
import { type ImportActionResult, runImport } from './actions';
import { ColumnMapper } from './ColumnMapper';
import styles from './import.module.css';
import { PreviewPane } from './PreviewPane';
import { UploadZone } from './UploadZone';

type Step = 'upload' | 'map' | 'preview' | 'done';

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
  const [pending, startTransition] = useTransition();

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

  const commit = useCallback(() => {
    const idempotencyKey = crypto.randomUUID();
    startTransition(async () => {
      const res = await runImport({ kind: spec.kind, csvText, mapping, idempotencyKey });
      setResult(res);
      if (res.ok) setStep('done');
    });
  }, [csvText, mapping, spec.kind]);

  const reset = useCallback(() => {
    setStep('upload');
    setFileName('');
    setCsvText('');
    setParsed(null);
    setMapping({});
    setResult(null);
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

      {step === 'done' && result?.ok ? (
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
  const activeIndex = STEPS.findIndex((s) => s.key === step);
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
