/**
 * Admin Network Service
 *
 * Provides admin-level network management capabilities including
 * fetching, searching, filtering networks (groups & communities),
 * and certifying communities.
 */

import { supabase } from '../supabase';

// =============================================================================
// TYPES
// =============================================================================

/** Network type filter */
export type AdminNetworkType = 'all' | 'player_group' | 'community';

/** Admin network filters */
export interface AdminNetworkFilters {
  networkType?: AdminNetworkType;
  isCertified?: boolean;
  searchQuery?: string;
  sportId?: string;
  isPrivate?: boolean;
}

/** Network info for admin view */
export interface AdminNetworkInfo {
  id: string;
  name: string;
  description: string | null;
  network_type: string;
  network_type_display: string;
  is_private: boolean;
  is_certified: boolean;
  certified_at: string | null;
  member_count: number;
  max_members: number | null;
  cover_image_url: string | null;
  sport_id: string | null;
  sport_name: string | null;
  created_by: string;
  creator_name: string | null;
  created_at: string;
}

/** Network member info */
export interface AdminNetworkMember {
  id: string;
  player_id: string;
  player_name: string | null;
  player_avatar: string | null;
  role: string;
  status: string;
  joined_at: string;
}

/** Favorite facility info */
export interface AdminNetworkFacility {
  id: string;
  name: string;
  address: string | null;
}

/** Detailed network info for admin view */
export interface AdminNetworkDetail {
  id: string;
  name: string;
  description: string | null;
  network_type: string;
  network_type_display: string;
  is_private: boolean;
  is_certified: boolean;
  certified_at: string | null;
  certified_by: string | null;
  certified_by_name: string | null;
  certification_notes: string | null;
  member_count: number;
  max_members: number | null;
  cover_image_url: string | null;
  sport_id: string | null;
  sport_name: string | null;
  invite_code: string | null;
  created_by: string;
  creator_name: string | null;
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
  members: AdminNetworkMember[] | null;
  favorite_facilities: AdminNetworkFacility[] | null;
}

/** Paginated admin networks response */
export interface AdminNetworksPage {
  networks: AdminNetworkInfo[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/** Parameters for fetching admin networks */
export interface FetchAdminNetworksParams {
  offset?: number;
  limit?: number;
  filters?: AdminNetworkFilters;
}

/** Certify network parameters */
export interface CertifyNetworkParams {
  networkId: string;
  isCertified: boolean;
  notes?: string;
}

/** Admin setting */
export interface AdminSetting {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/** Network limits setting */
export interface NetworkLimits {
  max_group_members: number;
  max_community_members: number | null;
}

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Fetch networks with admin-level access
 */
export async function fetchAdminNetworks(
  params: FetchAdminNetworksParams
): Promise<AdminNetworksPage> {
  const { offset = 0, limit = 20, filters = {} } = params;

  try {
    const { data, error } = await supabase.rpc('get_admin_networks', {
      p_search: filters.searchQuery || null,
      p_network_type: filters.networkType === 'all' ? null : filters.networkType || null,
      p_is_certified: filters.isCertified === undefined ? null : filters.isCertified,
      p_sport_id: filters.sportId || null,
      p_is_private: filters.isPrivate === undefined ? null : filters.isPrivate,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      throw new Error(`Failed to fetch networks: ${error.message}`);
    }

    const networks: AdminNetworkInfo[] = (data || []).map(
      (row: {
        id: string;
        name: string;
        description: string | null;
        network_type: string;
        network_type_display: string;
        is_private: boolean;
        is_certified: boolean;
        certified_at: string | null;
        member_count: number;
        max_members: number | null;
        cover_image_url: string | null;
        sport_id: string | null;
        sport_name: string | null;
        created_by: string;
        creator_name: string | null;
        created_at: string;
        total_count: number;
      }) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        network_type: row.network_type,
        network_type_display: row.network_type_display,
        is_private: row.is_private,
        is_certified: row.is_certified,
        certified_at: row.certified_at,
        member_count: row.member_count,
        max_members: row.max_members,
        cover_image_url: row.cover_image_url,
        sport_id: row.sport_id,
        sport_name: row.sport_name,
        created_by: row.created_by,
        creator_name: row.creator_name,
        created_at: row.created_at,
      })
    );

    // Get total count from first row (all rows have it)
    const totalCount = data?.length > 0 ? (data[0] as { total_count: number }).total_count : 0;
    const hasMore = offset + networks.length < totalCount;

    return {
      networks,
      totalCount,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  } catch (error) {
    console.error('Error fetching admin networks:', error);
    throw error;
  }
}

/**
 * Fetch detailed network info for admin
 */
export async function fetchAdminNetworkDetail(networkId: string): Promise<AdminNetworkDetail> {
  try {
    const { data, error } = await supabase.rpc('get_admin_network_detail', {
      p_network_id: networkId,
    });

    if (error) {
      throw new Error(`Failed to fetch network detail: ${error.message}`);
    }

    if (!data) {
      throw new Error('Network not found');
    }

    return data as AdminNetworkDetail;
  } catch (error) {
    console.error('Error fetching admin network detail:', error);
    throw error;
  }
}

/**
 * Certify or uncertify a community
 */
export async function certifyNetwork(
  params: CertifyNetworkParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('admin_certify_network', {
      p_network_id: params.networkId,
      p_is_certified: params.isCertified,
      p_notes: params.notes || null,
    });

    if (error) {
      throw new Error(`Failed to certify network: ${error.message}`);
    }

    return { success: data?.success ?? true };
  } catch (error) {
    console.error('Error certifying network:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get admin setting by key
 */
export async function getAdminSetting(key: string): Promise<unknown> {
  try {
    const { data, error } = await supabase.rpc('get_admin_setting', {
      p_key: key,
    });

    if (error) {
      throw new Error(`Failed to get admin setting: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error('Error getting admin setting:', error);
    throw error;
  }
}

/**
 * Update admin setting
 */
export async function updateAdminSetting(
  key: string,
  value: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('update_admin_setting', {
      p_key: key,
      p_value: value,
    });

    if (error) {
      throw new Error(`Failed to update admin setting: ${error.message}`);
    }

    return { success: data?.success ?? true };
  } catch (error) {
    console.error('Error updating admin setting:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get network limits setting
 */
export async function getNetworkLimits(): Promise<NetworkLimits> {
  const defaultLimits: NetworkLimits = {
    max_group_members: 20,
    max_community_members: null,
  };

  try {
    const setting = await getAdminSetting('network_limits');
    if (setting && typeof setting === 'object') {
      return {
        ...defaultLimits,
        ...(setting as Partial<NetworkLimits>),
      };
    }
    return defaultLimits;
  } catch {
    return defaultLimits;
  }
}

/**
 * Update network limits setting
 */
export async function updateNetworkLimits(
  limits: NetworkLimits
): Promise<{ success: boolean; error?: string }> {
  return updateAdminSetting('network_limits', limits);
}

/** Delete network parameters */
export interface DeleteNetworkParams {
  networkId: string;
  reason?: string;
}

/** Delete network result */
export interface DeleteNetworkResult {
  success: boolean;
  error?: string;
  networkName?: string;
  membersNotified?: number;
}

/**
 * Delete a network (group or community) as admin
 * Notifies all members before deletion
 */
export async function deleteNetwork(params: DeleteNetworkParams): Promise<DeleteNetworkResult> {
  try {
    const { data, error } = await supabase.rpc('admin_delete_network', {
      p_network_id: params.networkId,
      p_reason: params.reason || null,
    });

    if (error) {
      throw new Error(`Failed to delete network: ${error.message}`);
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Unknown error' };
    }

    return {
      success: true,
      networkName: data.network_name,
      membersNotified: data.members_notified,
    };
  } catch (error) {
    console.error('Error deleting network:', error);
    return { success: false, error: (error as Error).message };
  }
}

export default {
  fetchAdminNetworks,
  fetchAdminNetworkDetail,
  certifyNetwork,
  deleteNetwork,
  getAdminSetting,
  updateAdminSetting,
  getNetworkLimits,
  updateNetworkLimits,
};
