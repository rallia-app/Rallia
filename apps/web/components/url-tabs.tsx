'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouter, useSearchParams } from 'next/navigation';

interface UrlTabsProps {
  tabs: { value: string; label: string }[];
  activeTab: string;
  paramName?: string;
  children: React.ReactNode;
}

export function UrlTabs({ tabs, activeTab, paramName = 'tab', children }: UrlTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleTabChange = (value: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));

    // Clear all filter/sort/page params when switching tabs
    for (const key of Array.from(current.keys())) {
      if (key.startsWith('filter[') || key === 'page' || key === 'sortBy' || key === 'sortOrder') {
        current.delete(key);
      }
    }

    if (value === tabs[0]?.value) {
      current.delete(paramName);
    } else {
      current.set(paramName, value);
    }

    router.push(`?${current.toString()}`);
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList>
        {tabs.map(tab => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
