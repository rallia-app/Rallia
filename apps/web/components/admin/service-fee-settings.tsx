'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Percent } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface FeeConfig {
  pctBps: number;
  flatCents: number;
  capCents: number;
  updatedAt: string;
}

/** Dollars/percent text input → integer bps/cents; null when not a number. */
function toInt(input: string, scale: number): number | null {
  const n = Number.parseFloat(input.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * scale);
}

export function ServiceFeeSettings() {
  const t = useTranslations('admin.settings.serviceFee');

  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pct, setPct] = useState('');
  const [flat, setFlat] = useState('');
  const [cap, setCap] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'invalid' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/service-fee')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((config: FeeConfig) => {
        if (cancelled) return;
        setPct(String(config.pctBps / 100));
        setFlat((config.flatCents / 100).toFixed(2));
        setCap((config.capCents / 100).toFixed(2));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    const pctBps = toInt(pct, 100);
    const flatCents = toInt(flat, 100);
    const capCents = toInt(cap, 100);
    if (pctBps === null || pctBps > 10000 || flatCents === null || capCents === null) {
      setStatus('invalid');
      return;
    }
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/admin/service-fee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pctBps, flatCents, capCents }),
      });
      setStatus(res.ok ? 'saved' : 'error');
    } catch {
      setStatus('error');
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground m-0">{t('description')}</p>
      </CardHeader>
      <CardContent>
        {loadFailed ? (
          <p className="text-sm text-destructive m-0">{t('loadError')}</p>
        ) : (
          <div className="flex flex-col gap-4 max-w-md">
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="fee-pct">{t('pctLabel')}</Label>
                <div className="relative">
                  <Input
                    id="fee-pct"
                    inputMode="decimal"
                    value={pct}
                    onChange={e => setPct(e.target.value)}
                    disabled={!loaded || saving}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="fee-flat">{t('flatLabel')}</Label>
                <div className="relative">
                  <Input
                    id="fee-flat"
                    inputMode="decimal"
                    value={flat}
                    onChange={e => setFlat(e.target.value)}
                    disabled={!loaded || saving}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="fee-cap">{t('capLabel')}</Label>
                <div className="relative">
                  <Input
                    id="fee-cap"
                    inputMode="decimal"
                    value={cap}
                    onChange={e => setCap(e.target.value)}
                    disabled={!loaded || saving}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground m-0">{t('formulaHint')}</p>
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={!loaded || saving}>
                {saving ? t('saving') : t('save')}
              </Button>
              {status === 'saved' && <span className="text-sm text-emerald-600">{t('saved')}</span>}
              {status === 'invalid' && (
                <span className="text-sm text-destructive">{t('invalid')}</span>
              )}
              {status === 'error' && (
                <span className="text-sm text-destructive">{t('saveError')}</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
