'use client';

import { ContactDialog } from '@/components/contact-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { Edit2, Mail, Phone, Plus, Trash2, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Contact {
  id: string;
  contact_type: 'general' | 'reservation' | 'maintenance' | 'other';
  phone: string | null;
  email: string | null;
  website: string | null;
  is_primary: boolean;
  sport_id: string | null;
  notes: string | null;
  sport?: {
    id: string;
    name: string;
  } | null;
}

interface FacilityContactsSectionProps {
  facilityId: string;
  contacts: Contact[];
  canEdit: boolean;
}

export function FacilityContactsSection({
  facilityId,
  contacts,
  canEdit,
}: FacilityContactsSectionProps) {
  const t = useTranslations('facilities.contacts');
  const router = useRouter();

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleEdit = (contact: Contact) => {
    setSelectedContact(contact);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (contact: Contact) => {
    setSelectedContact(contact);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedContact) return;

    setDeleting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('facility_contact')
        .delete()
        .eq('id', selectedContact.id);

      if (error) throw error;

      setDeleteDialogOpen(false);
      setSelectedContact(null);
      router.refresh();
    } catch (err) {
      console.error('Error deleting contact:', err);
      alert(t('deleteError') || 'Failed to delete contact');
    } finally {
      setDeleting(false);
    }
  };

  // Group contacts by type
  const groupedContacts = contacts.reduce(
    (acc, contact) => {
      if (!acc[contact.contact_type]) {
        acc[contact.contact_type] = [];
      }
      acc[contact.contact_type].push(contact);
      return acc;
    },
    {} as Record<string, Contact[]>
  );

  const contactTypeOrder: Array<keyof typeof groupedContacts> = [
    'general',
    'reservation',
    'maintenance',
    'other',
  ];

  return (
    <>
      {canEdit && (
        <>
          <ContactDialog
            open={addDialogOpen}
            onOpenChange={setAddDialogOpen}
            facilityId={facilityId}
          />
          {selectedContact && (
            <ContactDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              facilityId={facilityId}
              initialData={selectedContact}
            />
          )}
        </>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteContact')}</DialogTitle>
            <DialogDescription>{t('deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? t('deleting') : t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t('title')}</CardTitle>
            <CardDescription>
              {contacts.length} {contacts.length === 1 ? t('contact') : t('contacts')}
            </CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              {t('addContact')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="size-8 mx-auto mb-2 opacity-50" />
              <p className="mb-4">{t('emptyState.description')}</p>
              {canEdit && (
                <Button variant="outline" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  {t('emptyState.addButton')}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {contactTypeOrder.map(type => {
                const typeContacts = groupedContacts[type] || [];
                if (typeContacts.length === 0) return null;

                return (
                  <div key={type}>
                    <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                      {t(`types.${type}`)}
                    </h4>
                    <div className="space-y-3">
                      {typeContacts.map(contact => (
                        <div
                          key={contact.id}
                          className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              {contact.is_primary && (
                                <Badge variant="default" className="text-xs">
                                  {t('primary')}
                                </Badge>
                              )}
                              {contact.sport && (
                                <Badge variant="outline" className="text-xs">
                                  {contact.sport.name}
                                </Badge>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {contact.phone && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Phone className="size-4 text-muted-foreground shrink-0" />
                                  <a
                                    href={`tel:${contact.phone}`}
                                    className="text-foreground hover:underline"
                                  >
                                    {contact.phone}
                                  </a>
                                </div>
                              )}
                              {contact.email && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Mail className="size-4 text-muted-foreground shrink-0" />
                                  <a
                                    href={`mailto:${contact.email}`}
                                    className="text-foreground hover:underline"
                                  >
                                    {contact.email}
                                  </a>
                                </div>
                              )}
                              {contact.website && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Globe className="size-4 text-muted-foreground shrink-0" />
                                  <a
                                    href={contact.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-foreground hover:underline"
                                  >
                                    {contact.website}
                                  </a>
                                </div>
                              )}
                              {contact.notes && (
                                <p className="text-sm text-muted-foreground mt-2">
                                  {contact.notes}
                                </p>
                              )}
                            </div>
                          </div>
                          {canEdit && (
                            <div className="flex items-center gap-2 ml-4 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEdit(contact)}
                                className="size-8"
                              >
                                <Edit2 className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteClick(contact)}
                                className="size-8 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
