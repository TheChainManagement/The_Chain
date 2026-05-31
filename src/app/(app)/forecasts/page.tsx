import { BenchStub } from '@/components/bench/BenchStub';

export const metadata = { title: 'Forecasts · The Chain' };

export default function ForecastsPage() {
  return (
    <BenchStub
      eyebrow="Statistical demand, not guesswork"
      title="Forecasts"
      prefix="Forecasts"
      message="Intermittent-demand forecasts (Croston, SBA, TSB) with confidence bands land once history is synced. Claude explains, it never forecasts."
    />
  );
}
