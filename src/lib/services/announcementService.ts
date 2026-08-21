// Announcements-domain service (Modularization Phase 4B) — extracted
// verbatim from src/lib/databaseService.ts's ANNOUNCEMENTS section. Spread
// into the databaseService object facade (see databaseService.ts) so every
// existing `databaseService.X(...)` call site keeps working unchanged —
// this file is not imported directly by any application call site in this
// slice.
import { checkSupabase, supabase, DEFAULT_TENANT_ID } from '../databaseService';
import { Announcement, AnnouncementRead } from '../../types';

export const announcementService = {
  // tenantId defaults to DEFAULT_TENANT_ID for resident-facing call sites;
  // Chief-facing callers pass their resolved tenant explicitly.
  async getAnnouncements(tenantId: string = DEFAULT_TENANT_ID): Promise<Announcement[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcements')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching announcements:', error);
      throw error;
    }
    return data || [];
  },

  async createAnnouncement(entry: {
    title: string;
    body: string;
    category: Announcement['category'];
    pinned?: boolean;
    created_by_workforce_id?: string | null;
  }, tenantId: string = DEFAULT_TENANT_ID): Promise<Announcement> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcements')
      .insert([{ pinned: false, ...entry, tenant_id: tenantId }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating announcement:', error);
      throw error;
    }
    return data;
  },

  async updateAnnouncement(id: string, updates: Partial<Pick<Announcement, 'title' | 'body' | 'category' | 'pinned'>>): Promise<Announcement> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcements')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating announcement:', error);
      throw error;
    }
    return data;
  },

  async markAnnouncementRead(announcementId: string, workforceId: string): Promise<AnnouncementRead> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcement_reads')
      .upsert([{ announcement_id: announcementId, workforce_id: workforceId }], {
        onConflict: 'announcement_id,workforce_id',
      })
      .select()
      .single();

    if (error) {
      console.warn('Error recording announcement read receipt:', error);
      throw error;
    }
    return data;
  },

  async getAnnouncementReadsForWorkforce(workforceId: string): Promise<AnnouncementRead[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcement_reads')
      .select('*')
      .eq('workforce_id', workforceId);

    if (error) {
      console.warn('Error fetching announcement read receipts:', error);
      throw error;
    }
    return data || [];
  },
};
