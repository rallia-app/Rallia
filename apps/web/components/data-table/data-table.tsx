'use client';

import { SortableTableHeader } from '@/components/sortable-table-header';
import { TablePagination } from '@/components/table-pagination';
import { Card, CardContent } from '@/components/ui/card';
import { DataTableBulkActions, type BulkActionDef } from './data-table-bulk-actions';
import { useState } from 'react';

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  items: T[];
  columns: ColumnDef<T>[];
  idField: keyof T;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  emptyIcon?: React.ReactNode;
  emptyMessage: string;
  bulkActions?: BulkActionDef[];
  bulkSelectedMessage?: (count: number) => string;
  onRowClick?: (item: T) => void;
  paginationNamespace?: string;
  selectable?: boolean;
}

export function DataTable<T>({
  items,
  columns,
  idField,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  sortBy,
  sortOrder,
  emptyIcon,
  emptyMessage,
  bulkActions,
  bulkSelectedMessage,
  onRowClick,
  paginationNamespace,
  selectable = true,
}: DataTableProps<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const getId = (item: T) => String(item[idField]);

  const handleSelectChange = (id: string, selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(items.map(getId)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleActionComplete = () => {
    setSelectedIds(new Set());
  };

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < items.length;
  const showCheckboxes = selectable && bulkActions && bulkActions.length > 0;

  return (
    <Card className="overflow-hidden flex flex-col">
      {items.length === 0 ? (
        <CardContent className="flex flex-col items-center justify-center py-12">
          {emptyIcon && <div className="mb-4">{emptyIcon}</div>}
          <p className="text-muted-foreground m-0">{emptyMessage}</p>
        </CardContent>
      ) : (
        <>
          {showCheckboxes && bulkActions && bulkSelectedMessage && (
            <DataTableBulkActions
              selectedIds={Array.from(selectedIds)}
              selectedMessage={bulkSelectedMessage(selectedIds.size)}
              actions={bulkActions}
              onActionComplete={handleActionComplete}
            />
          )}
          <div className="overflow-x-auto flex-1">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  {showCheckboxes && (
                    <th className="text-left px-3 py-2 text-sm font-semibold w-12">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={input => {
                          if (input) input.indeterminate = someSelected;
                        }}
                        onChange={handleSelectAll}
                        className="rounded border-input h-4 w-4"
                      />
                    </th>
                  )}
                  {columns.map(col =>
                    col.sortable ? (
                      <SortableTableHeader
                        key={col.key}
                        field={col.key}
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                      >
                        {col.header}
                      </SortableTableHeader>
                    ) : (
                      <th key={col.key} className="text-left px-3 py-2 text-sm font-semibold">
                        {col.header}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const id = getId(item);
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(item) : undefined}
                      className={`border-b hover:bg-muted/50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                    >
                      {showCheckboxes && (
                        <td className="px-3 py-2 text-sm" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(id)}
                            onChange={e => handleSelectChange(id, e.target.checked)}
                            className="rounded border-input h-4 w-4"
                          />
                        </td>
                      )}
                      {columns.map(col => (
                        <td key={col.key} className="px-3 py-2 text-sm">
                          {col.render(item)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            translationNamespace={paginationNamespace}
          />
        </>
      )}
    </Card>
  );
}
