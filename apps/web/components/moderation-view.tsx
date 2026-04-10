'use client';

import { BansDataTable } from '@/components/bans-data-table';
import { ReportsDataTable } from '@/components/reports-data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function ModerationView() {
  const t = useTranslations('admin.moderation');
  const [activeTab, setActiveTab] = useState('reports');

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList>
        <TabsTrigger value="reports">{t('reports')}</TabsTrigger>
        <TabsTrigger value="bans">{t('bans')}</TabsTrigger>
      </TabsList>

      <TabsContent value="reports" className="mt-6">
        <ReportsDataTable />
      </TabsContent>

      <TabsContent value="bans" className="mt-6">
        <BansDataTable />
      </TabsContent>
    </Tabs>
  );
}
