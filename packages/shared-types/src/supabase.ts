export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin: {
        Row: {
          assigned_at: string;
          id: string;
          notes: string | null;
          permissions: Json | null;
          role: Database['public']['Enums']['admin_role_enum'];
        };
        Insert: {
          assigned_at?: string;
          id: string;
          notes?: string | null;
          permissions?: Json | null;
          role: Database['public']['Enums']['admin_role_enum'];
        };
        Update: {
          assigned_at?: string;
          id?: string;
          notes?: string | null;
          permissions?: Json | null;
          role?: Database['public']['Enums']['admin_role_enum'];
        };
        Relationships: [
          {
            foreignKeyName: 'admin_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_alert: {
        Row: {
          action_url: string | null;
          alert_type: string;
          created_at: string;
          dismissed_at: string | null;
          dismissed_by: string | null;
          expires_at: string | null;
          id: string;
          is_dismissed: boolean;
          is_read: boolean;
          message: string;
          metadata: Json | null;
          read_at: string | null;
          read_by: string | null;
          severity: string;
          source_id: string | null;
          source_type: string | null;
          target_roles: string[] | null;
          title: string;
        };
        Insert: {
          action_url?: string | null;
          alert_type: string;
          created_at?: string;
          dismissed_at?: string | null;
          dismissed_by?: string | null;
          expires_at?: string | null;
          id?: string;
          is_dismissed?: boolean;
          is_read?: boolean;
          message: string;
          metadata?: Json | null;
          read_at?: string | null;
          read_by?: string | null;
          severity?: string;
          source_id?: string | null;
          source_type?: string | null;
          target_roles?: string[] | null;
          title: string;
        };
        Update: {
          action_url?: string | null;
          alert_type?: string;
          created_at?: string;
          dismissed_at?: string | null;
          dismissed_by?: string | null;
          expires_at?: string | null;
          id?: string;
          is_dismissed?: boolean;
          is_read?: boolean;
          message?: string;
          metadata?: Json | null;
          read_at?: string | null;
          read_by?: string | null;
          severity?: string;
          source_id?: string | null;
          source_type?: string | null;
          target_roles?: string[] | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_alert_dismissed_by_fkey';
            columns: ['dismissed_by'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'admin_alert_read_by_fkey';
            columns: ['read_by'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_alert_preference: {
        Row: {
          admin_id: string;
          alert_type: string;
          created_at: string;
          email_enabled: boolean;
          id: string;
          in_app_enabled: boolean;
          min_severity: string;
          push_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          admin_id: string;
          alert_type: string;
          created_at?: string;
          email_enabled?: boolean;
          id?: string;
          in_app_enabled?: boolean;
          min_severity?: string;
          push_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          admin_id?: string;
          alert_type?: string;
          created_at?: string;
          email_enabled?: boolean;
          id?: string;
          in_app_enabled?: boolean;
          min_severity?: string;
          push_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_alert_preference_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_audit_log: {
        Row: {
          action_type: Database['public']['Enums']['admin_action_type_enum'];
          admin_id: string;
          created_at: string;
          entity_id: string | null;
          entity_name: string | null;
          entity_type: Database['public']['Enums']['admin_entity_type_enum'];
          id: string;
          ip_address: unknown;
          metadata: Json | null;
          new_data: Json | null;
          old_data: Json | null;
          severity: string;
          user_agent: string | null;
        };
        Insert: {
          action_type: Database['public']['Enums']['admin_action_type_enum'];
          admin_id: string;
          created_at?: string;
          entity_id?: string | null;
          entity_name?: string | null;
          entity_type: Database['public']['Enums']['admin_entity_type_enum'];
          id?: string;
          ip_address?: unknown;
          metadata?: Json | null;
          new_data?: Json | null;
          old_data?: Json | null;
          severity?: string;
          user_agent?: string | null;
        };
        Update: {
          action_type?: Database['public']['Enums']['admin_action_type_enum'];
          admin_id?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_name?: string | null;
          entity_type?: Database['public']['Enums']['admin_entity_type_enum'];
          id?: string;
          ip_address?: unknown;
          metadata?: Json | null;
          new_data?: Json | null;
          old_data?: Json | null;
          severity?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_audit_log_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_device: {
        Row: {
          admin_id: string;
          created_at: string | null;
          device_name: string | null;
          id: string;
          is_active: boolean | null;
          last_active: string | null;
          platform: string;
          push_token: string;
          updated_at: string | null;
        };
        Insert: {
          admin_id: string;
          created_at?: string | null;
          device_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_active?: string | null;
          platform: string;
          push_token: string;
          updated_at?: string | null;
        };
        Update: {
          admin_id?: string;
          created_at?: string | null;
          device_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_active?: string | null;
          platform?: string;
          push_token?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'admin_device_admin_id_fkey';
            columns: ['admin_id'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
        ];
      };
      analytics_snapshot: {
        Row: {
          created_at: string;
          id: string;
          metric_metadata: Json | null;
          metric_name: string;
          metric_type: string;
          metric_value: number;
          snapshot_date: string;
          sport_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          metric_metadata?: Json | null;
          metric_name: string;
          metric_type: string;
          metric_value?: number;
          snapshot_date: string;
          sport_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          metric_metadata?: Json | null;
          metric_name?: string;
          metric_type?: string;
          metric_value?: number;
          snapshot_date?: string;
          sport_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'analytics_snapshot_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      availability_block: {
        Row: {
          block_date: string;
          block_type: Database['public']['Enums']['availability_block_type_enum'];
          court_id: string | null;
          created_at: string | null;
          created_by: string | null;
          end_time: string | null;
          facility_id: string;
          id: string;
          reason: string | null;
          start_time: string | null;
          updated_at: string | null;
        };
        Insert: {
          block_date: string;
          block_type?: Database['public']['Enums']['availability_block_type_enum'];
          court_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          end_time?: string | null;
          facility_id: string;
          id?: string;
          reason?: string | null;
          start_time?: string | null;
          updated_at?: string | null;
        };
        Update: {
          block_date?: string;
          block_type?: Database['public']['Enums']['availability_block_type_enum'];
          court_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          end_time?: string | null;
          facility_id?: string;
          id?: string;
          reason?: string | null;
          start_time?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'availability_block_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'availability_block_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'availability_block_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
        ];
      };
      beta_signup: {
        Row: {
          city: string;
          created_at: string | null;
          email: string;
          full_name: string;
          id: number;
          ip_address: string | null;
          location: string | null;
          phone: string | null;
          pickleball_level: string | null;
          plays_pickleball: boolean;
          plays_tennis: boolean;
          tennis_level: string | null;
        };
        Insert: {
          city: string;
          created_at?: string | null;
          email: string;
          full_name: string;
          id?: never;
          ip_address?: string | null;
          location?: string | null;
          phone?: string | null;
          pickleball_level?: string | null;
          plays_pickleball?: boolean;
          plays_tennis?: boolean;
          tennis_level?: string | null;
        };
        Update: {
          city?: string;
          created_at?: string | null;
          email?: string;
          full_name?: string;
          id?: never;
          ip_address?: string | null;
          location?: string | null;
          phone?: string | null;
          pickleball_level?: string | null;
          plays_pickleball?: boolean;
          plays_tennis?: boolean;
          tennis_level?: string | null;
        };
        Relationships: [];
      };
      booking: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          booking_date: string;
          booking_type: Database['public']['Enums']['booking_type_enum'];
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          court_id: string | null;
          court_slot_id: string | null;
          created_at: string | null;
          currency: string | null;
          end_time: string;
          id: string;
          metadata: Json | null;
          notes: string | null;
          organization_id: string | null;
          payment_method: Database['public']['Enums']['payment_method'] | null;
          payment_status: Database['public']['Enums']['payment_status'] | null;
          player_id: string | null;
          price_cents: number | null;
          refund_amount_cents: number | null;
          refund_status: string | null;
          requires_approval: boolean | null;
          start_time: string;
          status: Database['public']['Enums']['booking_status'] | null;
          stripe_charge_id: string | null;
          stripe_payment_intent_id: string | null;
          total_price: number | null;
          updated_at: string | null;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          booking_date: string;
          booking_type?: Database['public']['Enums']['booking_type_enum'];
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          court_id?: string | null;
          court_slot_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          end_time: string;
          id?: string;
          metadata?: Json | null;
          notes?: string | null;
          organization_id?: string | null;
          payment_method?: Database['public']['Enums']['payment_method'] | null;
          payment_status?: Database['public']['Enums']['payment_status'] | null;
          player_id?: string | null;
          price_cents?: number | null;
          refund_amount_cents?: number | null;
          refund_status?: string | null;
          requires_approval?: boolean | null;
          start_time: string;
          status?: Database['public']['Enums']['booking_status'] | null;
          stripe_charge_id?: string | null;
          stripe_payment_intent_id?: string | null;
          total_price?: number | null;
          updated_at?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          booking_date?: string;
          booking_type?: Database['public']['Enums']['booking_type_enum'];
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          court_id?: string | null;
          court_slot_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          end_time?: string;
          id?: string;
          metadata?: Json | null;
          notes?: string | null;
          organization_id?: string | null;
          payment_method?: Database['public']['Enums']['payment_method'] | null;
          payment_status?: Database['public']['Enums']['payment_status'] | null;
          player_id?: string | null;
          price_cents?: number | null;
          refund_amount_cents?: number | null;
          refund_status?: string | null;
          requires_approval?: boolean | null;
          start_time?: string;
          status?: Database['public']['Enums']['booking_status'] | null;
          stripe_charge_id?: string | null;
          stripe_payment_intent_id?: string | null;
          total_price?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_court_slot_id_fkey';
            columns: ['court_slot_id'];
            isOneToOne: false;
            referencedRelation: 'court_slot';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booking_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      cancellation_policy: {
        Row: {
          created_at: string | null;
          free_cancellation_hours: number | null;
          id: string;
          no_refund_hours: number | null;
          organization_id: string;
          partial_refund_hours: number | null;
          partial_refund_percent: number | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          free_cancellation_hours?: number | null;
          id?: string;
          no_refund_hours?: number | null;
          organization_id: string;
          partial_refund_hours?: number | null;
          partial_refund_percent?: number | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          free_cancellation_hours?: number | null;
          id?: string;
          no_refund_hours?: number | null;
          organization_id?: string;
          partial_refund_hours?: number | null;
          partial_refund_percent?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'cancellation_policy_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation: {
        Row: {
          conversation_type: Database['public']['Enums']['conversation_type'];
          created_at: string | null;
          created_by: string;
          id: string;
          match_id: string | null;
          picture_url: string | null;
          title: string | null;
          updated_at: string | null;
        };
        Insert: {
          conversation_type: Database['public']['Enums']['conversation_type'];
          created_at?: string | null;
          created_by: string;
          id?: string;
          match_id?: string | null;
          picture_url?: string | null;
          title?: string | null;
          updated_at?: string | null;
        };
        Update: {
          conversation_type?: Database['public']['Enums']['conversation_type'];
          created_at?: string | null;
          created_by?: string;
          id?: string;
          match_id?: string | null;
          picture_url?: string | null;
          title?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_participant: {
        Row: {
          archived_at: string | null;
          conversation_id: string;
          created_at: string | null;
          id: string;
          is_archived: boolean | null;
          is_muted: boolean | null;
          is_pinned: boolean | null;
          joined_at: string | null;
          last_read_at: string | null;
          pinned_at: string | null;
          player_id: string;
          updated_at: string | null;
        };
        Insert: {
          archived_at?: string | null;
          conversation_id: string;
          created_at?: string | null;
          id?: string;
          is_archived?: boolean | null;
          is_muted?: boolean | null;
          is_pinned?: boolean | null;
          joined_at?: string | null;
          last_read_at?: string | null;
          pinned_at?: string | null;
          player_id: string;
          updated_at?: string | null;
        };
        Update: {
          archived_at?: string | null;
          conversation_id?: string;
          created_at?: string | null;
          id?: string;
          is_archived?: boolean | null;
          is_muted?: boolean | null;
          is_pinned?: boolean | null;
          joined_at?: string | null;
          last_read_at?: string | null;
          pinned_at?: string | null;
          player_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_participant_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversation';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_participant_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      court: {
        Row: {
          attributes: Json | null;
          availability_status: Database['public']['Enums']['availability_enum'];
          court_number: number | null;
          created_at: string;
          external_provider_id: string | null;
          facility_id: string;
          id: string;
          indoor: boolean;
          is_active: boolean;
          lighting: boolean;
          lines_marked_for_multiple_sports: boolean;
          name: string | null;
          notes: string | null;
          surface_type: Database['public']['Enums']['surface_type_enum'] | null;
          updated_at: string;
        };
        Insert: {
          attributes?: Json | null;
          availability_status?: Database['public']['Enums']['availability_enum'];
          court_number?: number | null;
          created_at?: string;
          external_provider_id?: string | null;
          facility_id: string;
          id?: string;
          indoor?: boolean;
          is_active?: boolean;
          lighting?: boolean;
          lines_marked_for_multiple_sports?: boolean;
          name?: string | null;
          notes?: string | null;
          surface_type?: Database['public']['Enums']['surface_type_enum'] | null;
          updated_at?: string;
        };
        Update: {
          attributes?: Json | null;
          availability_status?: Database['public']['Enums']['availability_enum'];
          court_number?: number | null;
          created_at?: string;
          external_provider_id?: string | null;
          facility_id?: string;
          id?: string;
          indoor?: boolean;
          is_active?: boolean;
          lighting?: boolean;
          lines_marked_for_multiple_sports?: boolean;
          name?: string | null;
          notes?: string | null;
          surface_type?: Database['public']['Enums']['surface_type_enum'] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'courts_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
        ];
      };
      court_one_time_availability: {
        Row: {
          availability_date: string;
          court_id: string | null;
          created_at: string | null;
          created_by: string | null;
          end_time: string;
          facility_id: string;
          id: string;
          is_available: boolean;
          price_cents: number | null;
          reason: string | null;
          slot_duration_minutes: number;
          start_time: string;
          updated_at: string | null;
        };
        Insert: {
          availability_date: string;
          court_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          end_time: string;
          facility_id: string;
          id?: string;
          is_available?: boolean;
          price_cents?: number | null;
          reason?: string | null;
          slot_duration_minutes?: number;
          start_time: string;
          updated_at?: string | null;
        };
        Update: {
          availability_date?: string;
          court_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          end_time?: string;
          facility_id?: string;
          id?: string;
          is_available?: boolean;
          price_cents?: number | null;
          reason?: string | null;
          slot_duration_minutes?: number;
          start_time?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'court_one_time_availability_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'court_one_time_availability_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'court_one_time_availability_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
        ];
      };
      court_slot: {
        Row: {
          court_id: string | null;
          created_at: string | null;
          day_of_week: Database['public']['Enums']['day_of_week'];
          end_time: string;
          facility_id: string | null;
          id: string;
          is_available: boolean | null;
          name: string | null;
          price: number | null;
          price_cents: number | null;
          priority: number | null;
          slot_duration_minutes: number | null;
          start_time: string;
          updated_at: string | null;
          valid_from: string | null;
          valid_until: string | null;
        };
        Insert: {
          court_id?: string | null;
          created_at?: string | null;
          day_of_week: Database['public']['Enums']['day_of_week'];
          end_time: string;
          facility_id?: string | null;
          id?: string;
          is_available?: boolean | null;
          name?: string | null;
          price?: number | null;
          price_cents?: number | null;
          priority?: number | null;
          slot_duration_minutes?: number | null;
          start_time: string;
          updated_at?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Update: {
          court_id?: string | null;
          created_at?: string | null;
          day_of_week?: Database['public']['Enums']['day_of_week'];
          end_time?: string;
          facility_id?: string | null;
          id?: string;
          is_available?: boolean | null;
          name?: string | null;
          price?: number | null;
          price_cents?: number | null;
          priority?: number | null;
          slot_duration_minutes?: number | null;
          start_time?: string;
          updated_at?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'court_slot_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'court_slot_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
        ];
      };
      court_sport: {
        Row: {
          court_id: string;
          created_at: string;
          id: string;
          sport_id: string;
          updated_at: string;
        };
        Insert: {
          court_id: string;
          created_at?: string;
          id?: string;
          sport_id: string;
          updated_at?: string;
        };
        Update: {
          court_id?: string;
          created_at?: string;
          id?: string;
          sport_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'court_sport_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'court_sport_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      data_provider: {
        Row: {
          api_base_url: string;
          api_config: Json | null;
          booking_url_template: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          provider_type: string;
          updated_at: string;
        };
        Insert: {
          api_base_url: string;
          api_config?: Json | null;
          booking_url_template?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          provider_type: string;
          updated_at?: string;
        };
        Update: {
          api_base_url?: string;
          api_config?: Json | null;
          booking_url_template?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          provider_type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      delivery_attempt: {
        Row: {
          attempt_number: number;
          channel: Database['public']['Enums']['delivery_channel_enum'];
          created_at: string;
          error_message: string | null;
          id: string;
          invitation_id: string | null;
          notification_id: string | null;
          provider_response: Json | null;
          status: Database['public']['Enums']['delivery_status_enum'];
        };
        Insert: {
          attempt_number: number;
          channel: Database['public']['Enums']['delivery_channel_enum'];
          created_at?: string;
          error_message?: string | null;
          id?: string;
          invitation_id?: string | null;
          notification_id?: string | null;
          provider_response?: Json | null;
          status: Database['public']['Enums']['delivery_status_enum'];
        };
        Update: {
          attempt_number?: number;
          channel?: Database['public']['Enums']['delivery_channel_enum'];
          created_at?: string;
          error_message?: string | null;
          id?: string;
          invitation_id?: string | null;
          notification_id?: string | null;
          provider_response?: Json | null;
          status?: Database['public']['Enums']['delivery_status_enum'];
        };
        Relationships: [
          {
            foreignKeyName: 'delivery_attempt_notification_id_fkey';
            columns: ['notification_id'];
            isOneToOne: false;
            referencedRelation: 'notification';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'delivery_attempts_invitation_id_fkey';
            columns: ['invitation_id'];
            isOneToOne: false;
            referencedRelation: 'invitation';
            referencedColumns: ['id'];
          },
        ];
      };
      facility: {
        Row: {
          address: string | null;
          archived_at: string | null;
          attributes: Json | null;
          city: string | null;
          country: Database['public']['Enums']['country_enum'] | null;
          created_at: string;
          data_provider_id: string | null;
          description: string | null;
          external_provider_id: string | null;
          facility_type: Database['public']['Enums']['facility_type_enum'] | null;
          id: string;
          is_active: boolean;
          latitude: number | null;
          location: unknown;
          longitude: number | null;
          membership_required: boolean;
          name: string;
          organization_id: string;
          postal_code: string | null;
          slug: string;
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          archived_at?: string | null;
          attributes?: Json | null;
          city?: string | null;
          country?: Database['public']['Enums']['country_enum'] | null;
          created_at?: string;
          data_provider_id?: string | null;
          description?: string | null;
          external_provider_id?: string | null;
          facility_type?: Database['public']['Enums']['facility_type_enum'] | null;
          id?: string;
          is_active?: boolean;
          latitude?: number | null;
          location?: unknown;
          longitude?: number | null;
          membership_required?: boolean;
          name: string;
          organization_id: string;
          postal_code?: string | null;
          slug: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          archived_at?: string | null;
          attributes?: Json | null;
          city?: string | null;
          country?: Database['public']['Enums']['country_enum'] | null;
          created_at?: string;
          data_provider_id?: string | null;
          description?: string | null;
          external_provider_id?: string | null;
          facility_type?: Database['public']['Enums']['facility_type_enum'] | null;
          id?: string;
          is_active?: boolean;
          latitude?: number | null;
          location?: unknown;
          longitude?: number | null;
          membership_required?: boolean;
          name?: string;
          organization_id?: string;
          postal_code?: string | null;
          slug?: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'facility_data_provider_id_fkey';
            columns: ['data_provider_id'];
            isOneToOne: false;
            referencedRelation: 'data_provider';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'facility_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
        ];
      };
      facility_contact: {
        Row: {
          attributes: Json | null;
          contact_type: Database['public']['Enums']['facility_contact_type_enum'];
          created_at: string;
          email: string | null;
          facility_id: string;
          id: string;
          is_primary: boolean;
          notes: string | null;
          phone: string | null;
          sport_id: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          attributes?: Json | null;
          contact_type: Database['public']['Enums']['facility_contact_type_enum'];
          created_at?: string;
          email?: string | null;
          facility_id: string;
          id?: string;
          is_primary?: boolean;
          notes?: string | null;
          phone?: string | null;
          sport_id?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          attributes?: Json | null;
          contact_type?: Database['public']['Enums']['facility_contact_type_enum'];
          created_at?: string;
          email?: string | null;
          facility_id?: string;
          id?: string;
          is_primary?: boolean;
          notes?: string | null;
          phone?: string | null;
          sport_id?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'facility_contact_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'facility_contacts_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      facility_file: {
        Row: {
          display_order: number | null;
          facility_id: string;
          file_id: string;
          id: string;
          is_primary: boolean | null;
        };
        Insert: {
          display_order?: number | null;
          facility_id: string;
          file_id: string;
          id?: string;
          is_primary?: boolean | null;
        };
        Update: {
          display_order?: number | null;
          facility_id?: string;
          file_id?: string;
          id?: string;
          is_primary?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'facility_file_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'facility_file_file_id_fkey';
            columns: ['file_id'];
            isOneToOne: false;
            referencedRelation: 'file';
            referencedColumns: ['id'];
          },
        ];
      };
      facility_image: {
        Row: {
          created_at: string;
          description: string | null;
          display_order: number;
          facility_id: string;
          file_size: number | null;
          id: string;
          is_primary: boolean;
          metadata: Json | null;
          mime_type: string | null;
          storage_key: string;
          thumbnail_url: string | null;
          uploaded_at: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          display_order?: number;
          facility_id: string;
          file_size?: number | null;
          id?: string;
          is_primary?: boolean;
          metadata?: Json | null;
          mime_type?: string | null;
          storage_key: string;
          thumbnail_url?: string | null;
          uploaded_at?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          display_order?: number;
          facility_id?: string;
          file_size?: number | null;
          id?: string;
          is_primary?: boolean;
          metadata?: Json | null;
          mime_type?: string | null;
          storage_key?: string;
          thumbnail_url?: string | null;
          uploaded_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'facility_image_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
        ];
      };
      facility_sport: {
        Row: {
          created_at: string;
          facility_id: string;
          id: string;
          sport_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          facility_id: string;
          id?: string;
          sport_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          facility_id?: string;
          id?: string;
          sport_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'facility_sport_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'facility_sport_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      feedback: {
        Row: {
          admin_notes: string | null;
          app_version: string | null;
          category: string;
          created_at: string;
          device_info: Json | null;
          id: string;
          message: string;
          player_id: string | null;
          screenshot_urls: string[] | null;
          status: string;
          subject: string;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          app_version?: string | null;
          category: string;
          created_at?: string;
          device_info?: Json | null;
          id?: string;
          message: string;
          player_id?: string | null;
          screenshot_urls?: string[] | null;
          status?: string;
          subject: string;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          app_version?: string | null;
          category?: string;
          created_at?: string;
          device_info?: Json | null;
          id?: string;
          message?: string;
          player_id?: string | null;
          screenshot_urls?: string[] | null;
          status?: string;
          subject?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      file: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          duration_seconds: number | null;
          file_size: number;
          file_type: Database['public']['Enums']['file_type_enum'];
          id: string;
          is_deleted: boolean;
          metadata: Json | null;
          mime_type: string;
          original_name: string;
          storage_key: string;
          storage_provider: Database['public']['Enums']['storage_provider_enum'];
          thumbnail_status: string | null;
          thumbnail_url: string | null;
          updated_at: string;
          uploaded_by: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          duration_seconds?: number | null;
          file_size: number;
          file_type: Database['public']['Enums']['file_type_enum'];
          id?: string;
          is_deleted?: boolean;
          metadata?: Json | null;
          mime_type: string;
          original_name: string;
          storage_key: string;
          storage_provider?: Database['public']['Enums']['storage_provider_enum'];
          thumbnail_status?: string | null;
          thumbnail_url?: string | null;
          updated_at?: string;
          uploaded_by: string;
          url: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          duration_seconds?: number | null;
          file_size?: number;
          file_type?: Database['public']['Enums']['file_type_enum'];
          id?: string;
          is_deleted?: boolean;
          metadata?: Json | null;
          mime_type?: string;
          original_name?: string;
          storage_key?: string;
          storage_provider?: Database['public']['Enums']['storage_provider_enum'];
          thumbnail_status?: string | null;
          thumbnail_url?: string | null;
          updated_at?: string;
          uploaded_by?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'file_uploaded_by_fkey';
            columns: ['uploaded_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      group_activity: {
        Row: {
          activity_type: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          network_id: string;
          player_id: string;
          related_entity_id: string | null;
        };
        Insert: {
          activity_type: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          network_id: string;
          player_id: string;
          related_entity_id?: string | null;
        };
        Update: {
          activity_type?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          network_id?: string;
          player_id?: string;
          related_entity_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'group_activity_network_id_fkey';
            columns: ['network_id'];
            isOneToOne: false;
            referencedRelation: 'network';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'group_activity_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      instructor_profile: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          certifications: Json | null;
          created_at: string;
          currency: string | null;
          display_name: string;
          email: string | null;
          hourly_rate_cents: number | null;
          id: string;
          is_active: boolean;
          is_external: boolean;
          organization_id: string;
          organization_member_id: string | null;
          phone: string | null;
          specializations: Json | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          certifications?: Json | null;
          created_at?: string;
          currency?: string | null;
          display_name: string;
          email?: string | null;
          hourly_rate_cents?: number | null;
          id?: string;
          is_active?: boolean;
          is_external?: boolean;
          organization_id: string;
          organization_member_id?: string | null;
          phone?: string | null;
          specializations?: Json | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          certifications?: Json | null;
          created_at?: string;
          currency?: string | null;
          display_name?: string;
          email?: string | null;
          hourly_rate_cents?: number | null;
          id?: string;
          is_active?: boolean;
          is_external?: boolean;
          organization_id?: string;
          organization_member_id?: string | null;
          phone?: string | null;
          specializations?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'instructor_profile_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'instructor_profile_organization_member_id_fkey';
            columns: ['organization_member_id'];
            isOneToOne: false;
            referencedRelation: 'organization_member';
            referencedColumns: ['id'];
          },
        ];
      };
      invitation: {
        Row: {
          accepted_at: string | null;
          admin_role: Database['public']['Enums']['admin_role_enum'] | null;
          created_at: string;
          email: string | null;
          expires_at: string;
          id: string;
          invited_user_id: string | null;
          inviter_id: string;
          metadata: Json | null;
          organization_id: string | null;
          phone: string | null;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          role: Database['public']['Enums']['app_role_enum'];
          source: Database['public']['Enums']['invite_source_enum'];
          status: Database['public']['Enums']['invite_status_enum'];
          token: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          admin_role?: Database['public']['Enums']['admin_role_enum'] | null;
          created_at?: string;
          email?: string | null;
          expires_at: string;
          id?: string;
          invited_user_id?: string | null;
          inviter_id: string;
          metadata?: Json | null;
          organization_id?: string | null;
          phone?: string | null;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role?: Database['public']['Enums']['app_role_enum'];
          source?: Database['public']['Enums']['invite_source_enum'];
          status?: Database['public']['Enums']['invite_status_enum'];
          token: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          admin_role?: Database['public']['Enums']['admin_role_enum'] | null;
          created_at?: string;
          email?: string | null;
          expires_at?: string;
          id?: string;
          invited_user_id?: string | null;
          inviter_id?: string;
          metadata?: Json | null;
          organization_id?: string | null;
          phone?: string | null;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role?: Database['public']['Enums']['app_role_enum'];
          source?: Database['public']['Enums']['invite_source_enum'];
          status?: Database['public']['Enums']['invite_status_enum'];
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invitation_invited_user_id_fkey';
            columns: ['invited_user_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitation_inviter_id_fkey';
            columns: ['inviter_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitation_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitation_revoked_by_fkey';
            columns: ['revoked_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      match: {
        Row: {
          booking_id: string | null;
          cancelled_at: string | null;
          closed_at: string | null;
          cost_split_type: Database['public']['Enums']['cost_split_type_enum'] | null;
          court_id: string | null;
          court_status: Database['public']['Enums']['court_status_enum'] | null;
          created_at: string | null;
          created_by: string;
          custom_duration_minutes: number | null;
          custom_latitude: number | null;
          custom_longitude: number | null;
          duration: Database['public']['Enums']['match_duration_enum'] | null;
          end_time: string;
          estimated_cost: number | null;
          facility_id: string | null;
          format: Database['public']['Enums']['match_format_enum'] | null;
          host_edited_at: string | null;
          id: string;
          is_auto_generated: boolean | null;
          is_court_free: boolean | null;
          join_mode: Database['public']['Enums']['match_join_mode_enum'] | null;
          location: unknown;
          location_address: string | null;
          location_name: string | null;
          location_type: Database['public']['Enums']['location_type_enum'] | null;
          match_date: string;
          min_rating_score_id: string | null;
          mutually_cancelled: boolean | null;
          notes: string | null;
          player_expectation: Database['public']['Enums']['match_type_enum'];
          preferred_opponent_gender: Database['public']['Enums']['gender_enum'] | null;
          sport_id: string;
          start_time: string;
          timezone: string;
          updated_at: string | null;
          visibility: Database['public']['Enums']['match_visibility_enum'] | null;
          visible_in_communities: boolean;
          visible_in_groups: boolean;
        };
        Insert: {
          booking_id?: string | null;
          cancelled_at?: string | null;
          closed_at?: string | null;
          cost_split_type?: Database['public']['Enums']['cost_split_type_enum'] | null;
          court_id?: string | null;
          court_status?: Database['public']['Enums']['court_status_enum'] | null;
          created_at?: string | null;
          created_by: string;
          custom_duration_minutes?: number | null;
          custom_latitude?: number | null;
          custom_longitude?: number | null;
          duration?: Database['public']['Enums']['match_duration_enum'] | null;
          end_time: string;
          estimated_cost?: number | null;
          facility_id?: string | null;
          format?: Database['public']['Enums']['match_format_enum'] | null;
          host_edited_at?: string | null;
          id?: string;
          is_auto_generated?: boolean | null;
          is_court_free?: boolean | null;
          join_mode?: Database['public']['Enums']['match_join_mode_enum'] | null;
          location?: unknown;
          location_address?: string | null;
          location_name?: string | null;
          location_type?: Database['public']['Enums']['location_type_enum'] | null;
          match_date: string;
          min_rating_score_id?: string | null;
          mutually_cancelled?: boolean | null;
          notes?: string | null;
          player_expectation?: Database['public']['Enums']['match_type_enum'];
          preferred_opponent_gender?: Database['public']['Enums']['gender_enum'] | null;
          sport_id: string;
          start_time: string;
          timezone?: string;
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['match_visibility_enum'] | null;
          visible_in_communities?: boolean;
          visible_in_groups?: boolean;
        };
        Update: {
          booking_id?: string | null;
          cancelled_at?: string | null;
          closed_at?: string | null;
          cost_split_type?: Database['public']['Enums']['cost_split_type_enum'] | null;
          court_id?: string | null;
          court_status?: Database['public']['Enums']['court_status_enum'] | null;
          created_at?: string | null;
          created_by?: string;
          custom_duration_minutes?: number | null;
          custom_latitude?: number | null;
          custom_longitude?: number | null;
          duration?: Database['public']['Enums']['match_duration_enum'] | null;
          end_time?: string;
          estimated_cost?: number | null;
          facility_id?: string | null;
          format?: Database['public']['Enums']['match_format_enum'] | null;
          host_edited_at?: string | null;
          id?: string;
          is_auto_generated?: boolean | null;
          is_court_free?: boolean | null;
          join_mode?: Database['public']['Enums']['match_join_mode_enum'] | null;
          location?: unknown;
          location_address?: string | null;
          location_name?: string | null;
          location_type?: Database['public']['Enums']['location_type_enum'] | null;
          match_date?: string;
          min_rating_score_id?: string | null;
          mutually_cancelled?: boolean | null;
          notes?: string | null;
          player_expectation?: Database['public']['Enums']['match_type_enum'];
          preferred_opponent_gender?: Database['public']['Enums']['gender_enum'] | null;
          sport_id?: string;
          start_time?: string;
          timezone?: string;
          updated_at?: string | null;
          visibility?: Database['public']['Enums']['match_visibility_enum'] | null;
          visible_in_communities?: boolean;
          visible_in_groups?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'match_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'booking';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_min_rating_score_id_fkey';
            columns: ['min_rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'rating_score';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      match_feedback: {
        Row: {
          comments: string | null;
          created_at: string;
          id: string;
          match_id: string;
          opponent_id: string;
          reviewer_id: string;
          showed_up: boolean;
          star_rating: number | null;
          was_late: boolean | null;
        };
        Insert: {
          comments?: string | null;
          created_at?: string;
          id?: string;
          match_id: string;
          opponent_id: string;
          reviewer_id: string;
          showed_up: boolean;
          star_rating?: number | null;
          was_late?: boolean | null;
        };
        Update: {
          comments?: string | null;
          created_at?: string;
          id?: string;
          match_id?: string;
          opponent_id?: string;
          reviewer_id?: string;
          showed_up?: boolean;
          star_rating?: number | null;
          was_late?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'match_feedback_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_feedback_opponent_id_fkey';
            columns: ['opponent_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_feedback_reviewer_id_fkey';
            columns: ['reviewer_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      match_network: {
        Row: {
          id: string;
          match_id: string;
          network_id: string;
          posted_at: string;
          posted_by: string;
        };
        Insert: {
          id?: string;
          match_id: string;
          network_id: string;
          posted_at?: string;
          posted_by: string;
        };
        Update: {
          id?: string;
          match_id?: string;
          network_id?: string;
          posted_at?: string;
          posted_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'match_network_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_network_network_id_fkey';
            columns: ['network_id'];
            isOneToOne: false;
            referencedRelation: 'network';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_network_posted_by_fkey';
            columns: ['posted_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      match_participant: {
        Row: {
          aggregated_at: string | null;
          cancellation_notes: string | null;
          cancellation_reason: Database['public']['Enums']['cancellation_reason_enum'] | null;
          checked_in_at: string | null;
          created_at: string | null;
          feedback_completed: boolean;
          feedback_reminder_sent_at: string | null;
          id: string;
          initial_feedback_notification_sent_at: string | null;
          is_host: boolean | null;
          joined_at: string | null;
          match_id: string;
          match_outcome: Database['public']['Enums']['match_outcome_enum'] | null;
          player_id: string;
          score: number | null;
          showed_up: boolean | null;
          star_rating: number | null;
          status: Database['public']['Enums']['match_participant_status_enum'] | null;
          team_number: number | null;
          updated_at: string | null;
          was_late: boolean | null;
        };
        Insert: {
          aggregated_at?: string | null;
          cancellation_notes?: string | null;
          cancellation_reason?: Database['public']['Enums']['cancellation_reason_enum'] | null;
          checked_in_at?: string | null;
          created_at?: string | null;
          feedback_completed?: boolean;
          feedback_reminder_sent_at?: string | null;
          id?: string;
          initial_feedback_notification_sent_at?: string | null;
          is_host?: boolean | null;
          joined_at?: string | null;
          match_id: string;
          match_outcome?: Database['public']['Enums']['match_outcome_enum'] | null;
          player_id: string;
          score?: number | null;
          showed_up?: boolean | null;
          star_rating?: number | null;
          status?: Database['public']['Enums']['match_participant_status_enum'] | null;
          team_number?: number | null;
          updated_at?: string | null;
          was_late?: boolean | null;
        };
        Update: {
          aggregated_at?: string | null;
          cancellation_notes?: string | null;
          cancellation_reason?: Database['public']['Enums']['cancellation_reason_enum'] | null;
          checked_in_at?: string | null;
          created_at?: string | null;
          feedback_completed?: boolean;
          feedback_reminder_sent_at?: string | null;
          id?: string;
          initial_feedback_notification_sent_at?: string | null;
          is_host?: boolean | null;
          joined_at?: string | null;
          match_id?: string;
          match_outcome?: Database['public']['Enums']['match_outcome_enum'] | null;
          player_id?: string;
          score?: number | null;
          showed_up?: boolean | null;
          star_rating?: number | null;
          status?: Database['public']['Enums']['match_participant_status_enum'] | null;
          team_number?: number | null;
          updated_at?: string | null;
          was_late?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'match_participant_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_participant_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      match_report: {
        Row: {
          created_at: string;
          details: string | null;
          id: string;
          match_id: string;
          priority: Database['public']['Enums']['match_report_priority_enum'];
          reason: Database['public']['Enums']['match_report_reason_enum'];
          reported_id: string;
          reporter_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database['public']['Enums']['match_report_status_enum'];
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          id?: string;
          match_id: string;
          priority: Database['public']['Enums']['match_report_priority_enum'];
          reason: Database['public']['Enums']['match_report_reason_enum'];
          reported_id: string;
          reporter_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['match_report_status_enum'];
        };
        Update: {
          created_at?: string;
          details?: string | null;
          id?: string;
          match_id?: string;
          priority?: Database['public']['Enums']['match_report_priority_enum'];
          reason?: Database['public']['Enums']['match_report_reason_enum'];
          reported_id?: string;
          reporter_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['match_report_status_enum'];
        };
        Relationships: [
          {
            foreignKeyName: 'match_report_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_report_reported_id_fkey';
            columns: ['reported_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_report_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_report_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      match_result: {
        Row: {
          confirmation_deadline: string | null;
          confirmed_by: string | null;
          created_at: string | null;
          dispute_reason: string | null;
          disputed: boolean | null;
          id: string;
          is_verified: boolean | null;
          match_id: string;
          submitted_by: string | null;
          team1_score: number | null;
          team2_score: number | null;
          updated_at: string | null;
          verified_at: string | null;
          winning_team: number | null;
        };
        Insert: {
          confirmation_deadline?: string | null;
          confirmed_by?: string | null;
          created_at?: string | null;
          dispute_reason?: string | null;
          disputed?: boolean | null;
          id?: string;
          is_verified?: boolean | null;
          match_id: string;
          submitted_by?: string | null;
          team1_score?: number | null;
          team2_score?: number | null;
          updated_at?: string | null;
          verified_at?: string | null;
          winning_team?: number | null;
        };
        Update: {
          confirmation_deadline?: string | null;
          confirmed_by?: string | null;
          created_at?: string | null;
          dispute_reason?: string | null;
          disputed?: boolean | null;
          id?: string;
          is_verified?: boolean | null;
          match_id?: string;
          submitted_by?: string | null;
          team1_score?: number | null;
          team2_score?: number | null;
          updated_at?: string | null;
          verified_at?: string | null;
          winning_team?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'match_result_confirmed_by_fkey';
            columns: ['confirmed_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_result_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: true;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_result_submitted_by_fkey';
            columns: ['submitted_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      match_set: {
        Row: {
          created_at: string | null;
          id: string;
          match_result_id: string;
          set_number: number;
          team1_score: number;
          team2_score: number;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          match_result_id: string;
          set_number: number;
          team1_score: number;
          team2_score: number;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          match_result_id?: string;
          set_number?: number;
          team1_score?: number;
          team2_score?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'match_set_match_result_id_fkey';
            columns: ['match_result_id'];
            isOneToOne: false;
            referencedRelation: 'match_result';
            referencedColumns: ['id'];
          },
        ];
      };
      match_share: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          match_id: string;
          share_channel: Database['public']['Enums']['share_channel_enum'];
          share_link_token: string | null;
          shared_at: string;
          shared_by: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          match_id: string;
          share_channel: Database['public']['Enums']['share_channel_enum'];
          share_link_token?: string | null;
          shared_at?: string;
          shared_by: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          match_id?: string;
          share_channel?: Database['public']['Enums']['share_channel_enum'];
          share_link_token?: string | null;
          shared_at?: string;
          shared_by?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'match_share_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_share_shared_by_fkey';
            columns: ['shared_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      match_share_recipient: {
        Row: {
          contact_id: string | null;
          contact_list_id: string | null;
          converted_player_id: string | null;
          created_at: string;
          id: string;
          recipient_email: string | null;
          recipient_name: string;
          recipient_phone: string | null;
          responded_at: string | null;
          response_note: string | null;
          sent_at: string | null;
          share_id: string;
          status: Database['public']['Enums']['share_status_enum'];
          updated_at: string;
          viewed_at: string | null;
        };
        Insert: {
          contact_id?: string | null;
          contact_list_id?: string | null;
          converted_player_id?: string | null;
          created_at?: string;
          id?: string;
          recipient_email?: string | null;
          recipient_name: string;
          recipient_phone?: string | null;
          responded_at?: string | null;
          response_note?: string | null;
          sent_at?: string | null;
          share_id: string;
          status?: Database['public']['Enums']['share_status_enum'];
          updated_at?: string;
          viewed_at?: string | null;
        };
        Update: {
          contact_id?: string | null;
          contact_list_id?: string | null;
          converted_player_id?: string | null;
          created_at?: string;
          id?: string;
          recipient_email?: string | null;
          recipient_name?: string;
          recipient_phone?: string | null;
          responded_at?: string | null;
          response_note?: string | null;
          sent_at?: string | null;
          share_id?: string;
          status?: Database['public']['Enums']['share_status_enum'];
          updated_at?: string;
          viewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'match_share_recipient_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'shared_contact';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_share_recipient_contact_list_id_fkey';
            columns: ['contact_list_id'];
            isOneToOne: false;
            referencedRelation: 'shared_contact_list';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_share_recipient_converted_player_id_fkey';
            columns: ['converted_player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_share_recipient_share_id_fkey';
            columns: ['share_id'];
            isOneToOne: false;
            referencedRelation: 'match_share';
            referencedColumns: ['id'];
          },
        ];
      };
      message: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string | null;
          deleted_at: string | null;
          edited_at: string | null;
          id: string;
          is_edited: boolean | null;
          read_by: Json | null;
          reply_to_message_id: string | null;
          search_vector: unknown;
          sender_id: string;
          status: Database['public']['Enums']['message_status'] | null;
          updated_at: string | null;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string | null;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          is_edited?: boolean | null;
          read_by?: Json | null;
          reply_to_message_id?: string | null;
          search_vector?: unknown;
          sender_id: string;
          status?: Database['public']['Enums']['message_status'] | null;
          updated_at?: string | null;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string | null;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          is_edited?: boolean | null;
          read_by?: Json | null;
          reply_to_message_id?: string | null;
          search_vector?: unknown;
          sender_id?: string;
          status?: Database['public']['Enums']['message_status'] | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'message_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversation';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_reply_to_message_id_fkey';
            columns: ['reply_to_message_id'];
            isOneToOne: false;
            referencedRelation: 'message';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      message_reaction: {
        Row: {
          created_at: string | null;
          emoji: string;
          id: string;
          message_id: string;
          player_id: string;
        };
        Insert: {
          created_at?: string | null;
          emoji: string;
          id?: string;
          message_id: string;
          player_id: string;
        };
        Update: {
          created_at?: string | null;
          emoji?: string;
          id?: string;
          message_id?: string;
          player_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'message_reaction_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'message';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_reaction_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      network: {
        Row: {
          archived_at: string | null;
          conversation_id: string | null;
          cover_image_url: string | null;
          created_at: string | null;
          created_by: string;
          description: string | null;
          id: string;
          invite_code: string | null;
          is_private: boolean | null;
          max_members: number | null;
          member_count: number | null;
          name: string;
          network_type_id: string;
          updated_at: string | null;
        };
        Insert: {
          archived_at?: string | null;
          conversation_id?: string | null;
          cover_image_url?: string | null;
          created_at?: string | null;
          created_by: string;
          description?: string | null;
          id?: string;
          invite_code?: string | null;
          is_private?: boolean | null;
          max_members?: number | null;
          member_count?: number | null;
          name: string;
          network_type_id: string;
          updated_at?: string | null;
        };
        Update: {
          archived_at?: string | null;
          conversation_id?: string | null;
          cover_image_url?: string | null;
          created_at?: string | null;
          created_by?: string;
          description?: string | null;
          id?: string;
          invite_code?: string | null;
          is_private?: boolean | null;
          max_members?: number | null;
          member_count?: number | null;
          name?: string;
          network_type_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'network_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversation';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'network_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'network_network_type_id_fkey';
            columns: ['network_type_id'];
            isOneToOne: false;
            referencedRelation: 'network_type';
            referencedColumns: ['id'];
          },
        ];
      };
      network_member: {
        Row: {
          added_by: string | null;
          created_at: string | null;
          id: string;
          joined_at: string | null;
          network_id: string;
          player_id: string;
          request_type: Database['public']['Enums']['network_member_request_type'] | null;
          role: Database['public']['Enums']['network_member_role_enum'] | null;
          status: Database['public']['Enums']['network_member_status'] | null;
          updated_at: string | null;
        };
        Insert: {
          added_by?: string | null;
          created_at?: string | null;
          id?: string;
          joined_at?: string | null;
          network_id: string;
          player_id: string;
          request_type?: Database['public']['Enums']['network_member_request_type'] | null;
          role?: Database['public']['Enums']['network_member_role_enum'] | null;
          status?: Database['public']['Enums']['network_member_status'] | null;
          updated_at?: string | null;
        };
        Update: {
          added_by?: string | null;
          created_at?: string | null;
          id?: string;
          joined_at?: string | null;
          network_id?: string;
          player_id?: string;
          request_type?: Database['public']['Enums']['network_member_request_type'] | null;
          role?: Database['public']['Enums']['network_member_role_enum'] | null;
          status?: Database['public']['Enums']['network_member_status'] | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'network_member_added_by_fkey';
            columns: ['added_by'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'network_member_network_id_fkey';
            columns: ['network_id'];
            isOneToOne: false;
            referencedRelation: 'network';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'network_member_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      network_type: {
        Row: {
          created_at: string | null;
          description: string | null;
          display_name: string;
          id: string;
          is_active: boolean | null;
          name: string;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          display_name: string;
          id?: string;
          is_active?: boolean | null;
          name: string;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          display_name?: string;
          id?: string;
          is_active?: boolean | null;
          name?: string;
        };
        Relationships: [];
      };
      notification: {
        Row: {
          body: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          organization_id: string | null;
          payload: Json | null;
          priority: Database['public']['Enums']['notification_priority_enum'] | null;
          read_at: string | null;
          scheduled_at: string | null;
          target_id: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type_enum'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          organization_id?: string | null;
          payload?: Json | null;
          priority?: Database['public']['Enums']['notification_priority_enum'] | null;
          read_at?: string | null;
          scheduled_at?: string | null;
          target_id?: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type_enum'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          organization_id?: string | null;
          payload?: Json | null;
          priority?: Database['public']['Enums']['notification_priority_enum'] | null;
          read_at?: string | null;
          scheduled_at?: string | null;
          target_id?: string | null;
          title?: string;
          type?: Database['public']['Enums']['notification_type_enum'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_preference: {
        Row: {
          channel: Database['public']['Enums']['delivery_channel_enum'];
          created_at: string;
          enabled: boolean;
          id: string;
          notification_type: Database['public']['Enums']['notification_type_enum'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          channel: Database['public']['Enums']['delivery_channel_enum'];
          created_at?: string;
          enabled?: boolean;
          id?: string;
          notification_type: Database['public']['Enums']['notification_type_enum'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          channel?: Database['public']['Enums']['delivery_channel_enum'];
          created_at?: string;
          enabled?: boolean;
          id?: string;
          notification_type?: Database['public']['Enums']['notification_type_enum'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preference_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      onboarding_analytics: {
        Row: {
          completed: boolean | null;
          created_at: string;
          entered_at: string;
          exited_at: string | null;
          id: string;
          metadata: Json | null;
          player_id: string;
          screen_name: string;
          session_id: string | null;
          time_spent_seconds: number | null;
        };
        Insert: {
          completed?: boolean | null;
          created_at?: string;
          entered_at?: string;
          exited_at?: string | null;
          id?: string;
          metadata?: Json | null;
          player_id: string;
          screen_name: string;
          session_id?: string | null;
          time_spent_seconds?: number | null;
        };
        Update: {
          completed?: boolean | null;
          created_at?: string;
          entered_at?: string;
          exited_at?: string | null;
          id?: string;
          metadata?: Json | null;
          player_id?: string;
          screen_name?: string;
          session_id?: string | null;
          time_spent_seconds?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'onboarding_analytics_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      organization: {
        Row: {
          address: string | null;
          city: string | null;
          country: Database['public']['Enums']['country_enum'] | null;
          created_at: string;
          data_provider_id: string | null;
          description: string | null;
          email: string | null;
          id: string;
          is_active: boolean;
          name: string;
          nature: Database['public']['Enums']['organization_nature_enum'];
          owner_id: string | null;
          phone: string | null;
          postal_code: string | null;
          slug: string;
          type: Database['public']['Enums']['organization_type_enum'] | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          country?: Database['public']['Enums']['country_enum'] | null;
          created_at?: string;
          data_provider_id?: string | null;
          description?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          nature: Database['public']['Enums']['organization_nature_enum'];
          owner_id?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          slug: string;
          type?: Database['public']['Enums']['organization_type_enum'] | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          country?: Database['public']['Enums']['country_enum'] | null;
          created_at?: string;
          data_provider_id?: string | null;
          description?: string | null;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          nature?: Database['public']['Enums']['organization_nature_enum'];
          owner_id?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          slug?: string;
          type?: Database['public']['Enums']['organization_type_enum'] | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_data_provider_id_fkey';
            columns: ['data_provider_id'];
            isOneToOne: false;
            referencedRelation: 'data_provider';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_member: {
        Row: {
          id: string;
          invited_by: string | null;
          joined_at: string;
          left_at: string | null;
          organization_id: string;
          permissions: Json | null;
          role: Database['public']['Enums']['member_role'];
          user_id: string;
        };
        Insert: {
          id?: string;
          invited_by?: string | null;
          joined_at?: string;
          left_at?: string | null;
          organization_id: string;
          permissions?: Json | null;
          role?: Database['public']['Enums']['member_role'];
          user_id: string;
        };
        Update: {
          id?: string;
          invited_by?: string | null;
          joined_at?: string;
          left_at?: string | null;
          organization_id?: string;
          permissions?: Json | null;
          role?: Database['public']['Enums']['member_role'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_member_invited_by_fkey';
            columns: ['invited_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_member_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_member_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_notification_preference: {
        Row: {
          channel: Database['public']['Enums']['delivery_channel_enum'];
          created_at: string;
          enabled: boolean;
          id: string;
          notification_type: Database['public']['Enums']['notification_type_enum'];
          organization_id: string;
          recipient_roles: Database['public']['Enums']['role_enum'][] | null;
          updated_at: string;
        };
        Insert: {
          channel: Database['public']['Enums']['delivery_channel_enum'];
          created_at?: string;
          enabled?: boolean;
          id?: string;
          notification_type: Database['public']['Enums']['notification_type_enum'];
          organization_id: string;
          recipient_roles?: Database['public']['Enums']['role_enum'][] | null;
          updated_at?: string;
        };
        Update: {
          channel?: Database['public']['Enums']['delivery_channel_enum'];
          created_at?: string;
          enabled?: boolean;
          id?: string;
          notification_type?: Database['public']['Enums']['notification_type_enum'];
          organization_id?: string;
          recipient_roles?: Database['public']['Enums']['role_enum'][] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_notification_preference_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_notification_recipient: {
        Row: {
          created_at: string;
          enabled: boolean;
          id: string;
          notification_type: Database['public']['Enums']['notification_type_enum'];
          organization_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          notification_type: Database['public']['Enums']['notification_type_enum'];
          organization_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          enabled?: boolean;
          id?: string;
          notification_type?: Database['public']['Enums']['notification_type_enum'];
          organization_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_notification_recipient_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_notification_recipient_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_player_block: {
        Row: {
          blocked_by: string | null;
          blocked_until: string | null;
          created_at: string | null;
          id: string;
          is_active: boolean | null;
          organization_id: string;
          player_id: string;
          reason: string | null;
        };
        Insert: {
          blocked_by?: string | null;
          blocked_until?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          organization_id: string;
          player_id: string;
          reason?: string | null;
        };
        Update: {
          blocked_by?: string | null;
          blocked_until?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          organization_id?: string;
          player_id?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_player_block_blocked_by_fkey';
            columns: ['blocked_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_player_block_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_player_block_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_settings: {
        Row: {
          allow_same_day_booking: boolean | null;
          approval_timeout_hours: number | null;
          created_at: string | null;
          id: string;
          max_advance_booking_days: number | null;
          min_booking_notice_hours: number | null;
          organization_id: string;
          require_booking_approval: boolean | null;
          slot_duration_minutes: number | null;
          updated_at: string | null;
        };
        Insert: {
          allow_same_day_booking?: boolean | null;
          approval_timeout_hours?: number | null;
          created_at?: string | null;
          id?: string;
          max_advance_booking_days?: number | null;
          min_booking_notice_hours?: number | null;
          organization_id: string;
          require_booking_approval?: boolean | null;
          slot_duration_minutes?: number | null;
          updated_at?: string | null;
        };
        Update: {
          allow_same_day_booking?: boolean | null;
          approval_timeout_hours?: number | null;
          created_at?: string | null;
          id?: string;
          max_advance_booking_days?: number | null;
          min_booking_notice_hours?: number | null;
          organization_id?: string;
          require_booking_approval?: boolean | null;
          slot_duration_minutes?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_settings_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
        ];
      };
      organization_stripe_account: {
        Row: {
          charges_enabled: boolean | null;
          created_at: string | null;
          default_currency: string | null;
          id: string;
          onboarding_complete: boolean | null;
          organization_id: string;
          payouts_enabled: boolean | null;
          stripe_account_id: string;
          stripe_account_type: string | null;
          updated_at: string | null;
        };
        Insert: {
          charges_enabled?: boolean | null;
          created_at?: string | null;
          default_currency?: string | null;
          id?: string;
          onboarding_complete?: boolean | null;
          organization_id: string;
          payouts_enabled?: boolean | null;
          stripe_account_id: string;
          stripe_account_type?: string | null;
          updated_at?: string | null;
        };
        Update: {
          charges_enabled?: boolean | null;
          created_at?: string | null;
          default_currency?: string | null;
          id?: string;
          onboarding_complete?: boolean | null;
          organization_id?: string;
          payouts_enabled?: boolean | null;
          stripe_account_id?: string;
          stripe_account_type?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_stripe_account_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
        ];
      };
      peer_rating_request: {
        Row: {
          assigned_rating_score_id: string | null;
          created_at: string;
          evaluator_id: string;
          expires_at: string;
          id: string;
          message: string | null;
          rating_system_id: string;
          requester_id: string;
          responded_at: string | null;
          response_message: string | null;
          status: Database['public']['Enums']['rating_request_status_enum'];
          updated_at: string;
        };
        Insert: {
          assigned_rating_score_id?: string | null;
          created_at?: string;
          evaluator_id: string;
          expires_at: string;
          id?: string;
          message?: string | null;
          rating_system_id: string;
          requester_id: string;
          responded_at?: string | null;
          response_message?: string | null;
          status?: Database['public']['Enums']['rating_request_status_enum'];
          updated_at?: string;
        };
        Update: {
          assigned_rating_score_id?: string | null;
          created_at?: string;
          evaluator_id?: string;
          expires_at?: string;
          id?: string;
          message?: string | null;
          rating_system_id?: string;
          requester_id?: string;
          responded_at?: string | null;
          response_message?: string | null;
          status?: Database['public']['Enums']['rating_request_status_enum'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'peer_rating_requests_assigned_rating_score_id_fkey';
            columns: ['assigned_rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'rating_score';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'peer_rating_requests_rating_system_id_fkey';
            columns: ['rating_system_id'];
            isOneToOne: false;
            referencedRelation: 'rating_system';
            referencedColumns: ['id'];
          },
        ];
      };
      play_attribute: {
        Row: {
          category: string | null;
          created_at: string | null;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          sport_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          category?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          sport_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          category?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          sport_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'play_attributes_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      play_style: {
        Row: {
          created_at: string | null;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          sport_id: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          sport_id: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          sport_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'play_styles_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      player: {
        Row: {
          address: string | null;
          chat_rules_agreed_at: string | null;
          city: string | null;
          country: string | null;
          created_at: string | null;
          expo_push_token: string | null;
          gender: Database['public']['Enums']['gender_enum'] | null;
          id: string;
          last_seen_at: string | null;
          latitude: number | null;
          location: unknown;
          longitude: number | null;
          max_travel_distance: number | null;
          notification_match_requests: boolean | null;
          notification_messages: boolean | null;
          notification_reminders: boolean | null;
          playing_hand: Database['public']['Enums']['playing_hand'] | null;
          postal_code: string | null;
          privacy_show_age: boolean | null;
          privacy_show_location: boolean | null;
          privacy_show_stats: boolean | null;
          province: string | null;
          push_notifications_enabled: boolean | null;
          reputation_score: number;
          updated_at: string | null;
        };
        Insert: {
          address?: string | null;
          chat_rules_agreed_at?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string | null;
          expo_push_token?: string | null;
          gender?: Database['public']['Enums']['gender_enum'] | null;
          id: string;
          last_seen_at?: string | null;
          latitude?: number | null;
          location?: unknown;
          longitude?: number | null;
          max_travel_distance?: number | null;
          notification_match_requests?: boolean | null;
          notification_messages?: boolean | null;
          notification_reminders?: boolean | null;
          playing_hand?: Database['public']['Enums']['playing_hand'] | null;
          postal_code?: string | null;
          privacy_show_age?: boolean | null;
          privacy_show_location?: boolean | null;
          privacy_show_stats?: boolean | null;
          province?: string | null;
          push_notifications_enabled?: boolean | null;
          reputation_score?: number;
          updated_at?: string | null;
        };
        Update: {
          address?: string | null;
          chat_rules_agreed_at?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string | null;
          expo_push_token?: string | null;
          gender?: Database['public']['Enums']['gender_enum'] | null;
          id?: string;
          last_seen_at?: string | null;
          latitude?: number | null;
          location?: unknown;
          longitude?: number | null;
          max_travel_distance?: number | null;
          notification_match_requests?: boolean | null;
          notification_messages?: boolean | null;
          notification_reminders?: boolean | null;
          playing_hand?: Database['public']['Enums']['playing_hand'] | null;
          postal_code?: string | null;
          privacy_show_age?: boolean | null;
          privacy_show_location?: boolean | null;
          privacy_show_stats?: boolean | null;
          province?: string | null;
          push_notifications_enabled?: boolean | null;
          reputation_score?: number;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'player_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      player_availability: {
        Row: {
          created_at: string;
          day: Database['public']['Enums']['day_enum'];
          id: string;
          is_active: boolean;
          period: Database['public']['Enums']['period_enum'];
          player_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          day: Database['public']['Enums']['day_enum'];
          id?: string;
          is_active?: boolean;
          period: Database['public']['Enums']['period_enum'];
          player_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          day?: Database['public']['Enums']['day_enum'];
          id?: string;
          is_active?: boolean;
          period?: Database['public']['Enums']['period_enum'];
          player_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_availability_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      player_ban: {
        Row: {
          ban_type: Database['public']['Enums']['ban_type_enum'];
          banned_at: string;
          banned_by_admin_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          is_active: boolean;
          lift_reason: string | null;
          lifted_at: string | null;
          lifted_by_admin_id: string | null;
          notes: string | null;
          player_id: string;
          reason: string;
          updated_at: string;
        };
        Insert: {
          ban_type?: Database['public']['Enums']['ban_type_enum'];
          banned_at?: string;
          banned_by_admin_id: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          lift_reason?: string | null;
          lifted_at?: string | null;
          lifted_by_admin_id?: string | null;
          notes?: string | null;
          player_id: string;
          reason: string;
          updated_at?: string;
        };
        Update: {
          ban_type?: Database['public']['Enums']['ban_type_enum'];
          banned_at?: string;
          banned_by_admin_id?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          lift_reason?: string | null;
          lifted_at?: string | null;
          lifted_by_admin_id?: string | null;
          notes?: string | null;
          player_id?: string;
          reason?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_ban_banned_by_admin_id_fkey';
            columns: ['banned_by_admin_id'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_ban_lifted_by_admin_id_fkey';
            columns: ['lifted_by_admin_id'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_ban_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      player_block: {
        Row: {
          blocked_player_id: string;
          created_at: string | null;
          id: string;
          player_id: string;
        };
        Insert: {
          blocked_player_id: string;
          created_at?: string | null;
          id?: string;
          player_id: string;
        };
        Update: {
          blocked_player_id?: string;
          created_at?: string | null;
          id?: string;
          player_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_block_blocked_player_id_fkey';
            columns: ['blocked_player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_block_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      player_favorite: {
        Row: {
          created_at: string | null;
          favorite_player_id: string;
          id: string;
          player_id: string;
        };
        Insert: {
          created_at?: string | null;
          favorite_player_id: string;
          id?: string;
          player_id: string;
        };
        Update: {
          created_at?: string | null;
          favorite_player_id?: string;
          id?: string;
          player_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_favorite_favorite_player_id_fkey';
            columns: ['favorite_player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_favorite_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      player_favorite_facility: {
        Row: {
          created_at: string;
          display_order: number;
          facility_id: string;
          id: string;
          player_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_order?: number;
          facility_id: string;
          id?: string;
          player_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_order?: number;
          facility_id?: string;
          id?: string;
          player_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_favorite_facility_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_favorite_facility_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      player_rating_score: {
        Row: {
          approved_proofs_count: number;
          assigned_at: string;
          badge_status: Database['public']['Enums']['badge_status_enum'];
          certified_at: string | null;
          certified_via: Database['public']['Enums']['rating_certification_method_enum'] | null;
          created_at: string;
          evaluations_count: number;
          expires_at: string | null;
          external_rating_score_id: string | null;
          id: string;
          is_certified: boolean;
          last_evaluated_at: string | null;
          level_changed_at: string | null;
          notes: string | null;
          peer_evaluation_average: number | null;
          peer_evaluation_count: number;
          player_id: string;
          previous_rating_score_id: string | null;
          rating_score_id: string;
          referrals_count: number;
          source: string | null;
          updated_at: string;
        };
        Insert: {
          approved_proofs_count?: number;
          assigned_at?: string;
          badge_status?: Database['public']['Enums']['badge_status_enum'];
          certified_at?: string | null;
          certified_via?: Database['public']['Enums']['rating_certification_method_enum'] | null;
          created_at?: string;
          evaluations_count?: number;
          expires_at?: string | null;
          external_rating_score_id?: string | null;
          id?: string;
          is_certified?: boolean;
          last_evaluated_at?: string | null;
          level_changed_at?: string | null;
          notes?: string | null;
          peer_evaluation_average?: number | null;
          peer_evaluation_count?: number;
          player_id: string;
          previous_rating_score_id?: string | null;
          rating_score_id: string;
          referrals_count?: number;
          source?: string | null;
          updated_at?: string;
        };
        Update: {
          approved_proofs_count?: number;
          assigned_at?: string;
          badge_status?: Database['public']['Enums']['badge_status_enum'];
          certified_at?: string | null;
          certified_via?: Database['public']['Enums']['rating_certification_method_enum'] | null;
          created_at?: string;
          evaluations_count?: number;
          expires_at?: string | null;
          external_rating_score_id?: string | null;
          id?: string;
          is_certified?: boolean;
          last_evaluated_at?: string | null;
          level_changed_at?: string | null;
          notes?: string | null;
          peer_evaluation_average?: number | null;
          peer_evaluation_count?: number;
          player_id?: string;
          previous_rating_score_id?: string | null;
          rating_score_id?: string;
          referrals_count?: number;
          source?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_rating_score_previous_rating_score_id_fkey';
            columns: ['previous_rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'rating_score';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_rating_scores_external_rating_score_id_fkey';
            columns: ['external_rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'rating_score';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_rating_scores_rating_score_id_fkey';
            columns: ['rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'rating_score';
            referencedColumns: ['id'];
          },
        ];
      };
      player_report: {
        Row: {
          action_taken: string | null;
          admin_notes: string | null;
          created_at: string;
          description: string | null;
          evidence_urls: string[] | null;
          id: string;
          priority: string | null;
          related_match_id: string | null;
          report_type: Database['public']['Enums']['report_type_enum'];
          reported_player_id: string;
          reporter_id: string;
          resulting_ban_id: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database['public']['Enums']['report_status_enum'];
          updated_at: string;
        };
        Insert: {
          action_taken?: string | null;
          admin_notes?: string | null;
          created_at?: string;
          description?: string | null;
          evidence_urls?: string[] | null;
          id?: string;
          priority?: string | null;
          related_match_id?: string | null;
          report_type: Database['public']['Enums']['report_type_enum'];
          reported_player_id: string;
          reporter_id: string;
          resulting_ban_id?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['report_status_enum'];
          updated_at?: string;
        };
        Update: {
          action_taken?: string | null;
          admin_notes?: string | null;
          created_at?: string;
          description?: string | null;
          evidence_urls?: string[] | null;
          id?: string;
          priority?: string | null;
          related_match_id?: string | null;
          report_type?: Database['public']['Enums']['report_type_enum'];
          reported_player_id?: string;
          reporter_id?: string;
          resulting_ban_id?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['report_status_enum'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_report_related_match_id_fkey';
            columns: ['related_match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_report_reported_player_id_fkey';
            columns: ['reported_player_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_report_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_report_resulting_ban_id_fkey';
            columns: ['resulting_ban_id'];
            isOneToOne: false;
            referencedRelation: 'player_ban';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_report_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'admin';
            referencedColumns: ['id'];
          },
        ];
      };
      player_reputation: {
        Row: {
          calculated_at: string;
          created_at: string;
          is_public: boolean;
          last_decay_calculation: string | null;
          matches_completed: number;
          negative_events: number;
          player_id: string;
          positive_events: number;
          reputation_score: number;
          reputation_tier: Database['public']['Enums']['reputation_tier'];
          total_events: number;
          updated_at: string;
        };
        Insert: {
          calculated_at?: string;
          created_at?: string;
          is_public?: boolean;
          last_decay_calculation?: string | null;
          matches_completed?: number;
          negative_events?: number;
          player_id: string;
          positive_events?: number;
          reputation_score?: number;
          reputation_tier?: Database['public']['Enums']['reputation_tier'];
          total_events?: number;
          updated_at?: string;
        };
        Update: {
          calculated_at?: string;
          created_at?: string;
          is_public?: boolean;
          last_decay_calculation?: string | null;
          matches_completed?: number;
          negative_events?: number;
          player_id?: string;
          positive_events?: number;
          reputation_score?: number;
          reputation_tier?: Database['public']['Enums']['reputation_tier'];
          total_events?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_reputation_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: true;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      player_review: {
        Row: {
          comment: string | null;
          created_at: string | null;
          id: string;
          match_id: string | null;
          rating: number | null;
          reviewed_id: string;
          reviewer_id: string;
          skill_rating_score_id: string | null;
          skill_rating_value: number | null;
          sport_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          comment?: string | null;
          created_at?: string | null;
          id?: string;
          match_id?: string | null;
          rating?: number | null;
          reviewed_id: string;
          reviewer_id: string;
          skill_rating_score_id?: string | null;
          skill_rating_value?: number | null;
          sport_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          comment?: string | null;
          created_at?: string | null;
          id?: string;
          match_id?: string | null;
          rating?: number | null;
          reviewed_id?: string;
          reviewer_id?: string;
          skill_rating_score_id?: string | null;
          skill_rating_value?: number | null;
          sport_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'player_review_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_review_reviewed_id_fkey';
            columns: ['reviewed_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_review_reviewer_id_fkey';
            columns: ['reviewer_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      player_sport: {
        Row: {
          created_at: string | null;
          id: string;
          is_active: boolean | null;
          is_primary: boolean | null;
          player_id: string;
          preferred_court: string | null;
          preferred_facility_id: string | null;
          preferred_match_duration: Database['public']['Enums']['match_duration_enum'] | null;
          preferred_match_type: Database['public']['Enums']['match_type_enum'] | null;
          preferred_play_attributes: Database['public']['Enums']['play_attribute_enum'][] | null;
          preferred_play_style: Database['public']['Enums']['play_style_enum'] | null;
          sport_id: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_primary?: boolean | null;
          player_id: string;
          preferred_court?: string | null;
          preferred_facility_id?: string | null;
          preferred_match_duration?: Database['public']['Enums']['match_duration_enum'] | null;
          preferred_match_type?: Database['public']['Enums']['match_type_enum'] | null;
          preferred_play_attributes?: Database['public']['Enums']['play_attribute_enum'][] | null;
          preferred_play_style?: Database['public']['Enums']['play_style_enum'] | null;
          sport_id: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_primary?: boolean | null;
          player_id?: string;
          preferred_court?: string | null;
          preferred_facility_id?: string | null;
          preferred_match_duration?: Database['public']['Enums']['match_duration_enum'] | null;
          preferred_match_type?: Database['public']['Enums']['match_type_enum'] | null;
          preferred_play_attributes?: Database['public']['Enums']['play_attribute_enum'][] | null;
          preferred_play_style?: Database['public']['Enums']['play_style_enum'] | null;
          sport_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'player_sport_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_sport_preferred_facility_id_fkey';
            columns: ['preferred_facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_sport_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      player_sport_play_attribute: {
        Row: {
          created_at: string;
          id: string;
          play_attribute_id: string;
          player_sport_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          play_attribute_id: string;
          player_sport_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          play_attribute_id?: string;
          player_sport_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_sport_play_attribute_play_attribute_id_fkey';
            columns: ['play_attribute_id'];
            isOneToOne: false;
            referencedRelation: 'play_attribute';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_sport_play_attribute_player_sport_id_fkey';
            columns: ['player_sport_id'];
            isOneToOne: false;
            referencedRelation: 'player_sport';
            referencedColumns: ['id'];
          },
        ];
      };
      player_sport_play_style: {
        Row: {
          created_at: string;
          id: string;
          play_style_id: string;
          player_sport_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          play_style_id: string;
          player_sport_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          play_style_id?: string;
          player_sport_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'player_sport_play_style_play_style_id_fkey';
            columns: ['play_style_id'];
            isOneToOne: false;
            referencedRelation: 'play_style';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_sport_play_style_player_sport_id_fkey';
            columns: ['player_sport_id'];
            isOneToOne: true;
            referencedRelation: 'player_sport';
            referencedColumns: ['id'];
          },
        ];
      };
      pricing_rule: {
        Row: {
          court_id: string | null;
          created_at: string | null;
          currency: string | null;
          days_of_week: number[];
          end_time: string;
          facility_id: string | null;
          id: string;
          is_active: boolean | null;
          name: string;
          organization_id: string;
          price_cents: number;
          priority: number | null;
          start_time: string;
          updated_at: string | null;
          valid_from: string | null;
          valid_until: string | null;
        };
        Insert: {
          court_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          days_of_week: number[];
          end_time: string;
          facility_id?: string | null;
          id?: string;
          is_active?: boolean | null;
          name: string;
          organization_id: string;
          price_cents: number;
          priority?: number | null;
          start_time: string;
          updated_at?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Update: {
          court_id?: string | null;
          created_at?: string | null;
          currency?: string | null;
          days_of_week?: number[];
          end_time?: string;
          facility_id?: string | null;
          id?: string;
          is_active?: boolean | null;
          name?: string;
          organization_id?: string;
          price_cents?: number;
          priority?: number | null;
          start_time?: string;
          updated_at?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pricing_rule_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pricing_rule_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pricing_rule_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
        ];
      };
      profile: {
        Row: {
          account_status: Database['public']['Enums']['account_status'] | null;
          bio: string | null;
          birth_date: string | null;
          created_at: string | null;
          display_name: string | null;
          email: string;
          email_verified: boolean | null;
          first_name: string | null;
          id: string;
          is_active: boolean | null;
          last_active_at: string | null;
          last_name: string | null;
          onboarding_completed: boolean | null;
          phone: string | null;
          phone_verified: boolean | null;
          preferred_locale: Database['public']['Enums']['locale_enum'] | null;
          profile_picture_url: string | null;
          updated_at: string | null;
        };
        Insert: {
          account_status?: Database['public']['Enums']['account_status'] | null;
          bio?: string | null;
          birth_date?: string | null;
          created_at?: string | null;
          display_name?: string | null;
          email: string;
          email_verified?: boolean | null;
          first_name?: string | null;
          id: string;
          is_active?: boolean | null;
          last_active_at?: string | null;
          last_name?: string | null;
          onboarding_completed?: boolean | null;
          phone?: string | null;
          phone_verified?: boolean | null;
          preferred_locale?: Database['public']['Enums']['locale_enum'] | null;
          profile_picture_url?: string | null;
          updated_at?: string | null;
        };
        Update: {
          account_status?: Database['public']['Enums']['account_status'] | null;
          bio?: string | null;
          birth_date?: string | null;
          created_at?: string | null;
          display_name?: string | null;
          email?: string;
          email_verified?: boolean | null;
          first_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_active_at?: string | null;
          last_name?: string | null;
          onboarding_completed?: boolean | null;
          phone?: string | null;
          phone_verified?: boolean | null;
          preferred_locale?: Database['public']['Enums']['locale_enum'] | null;
          profile_picture_url?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      program: {
        Row: {
          age_max: number | null;
          age_min: number | null;
          allow_installments: boolean;
          auto_block_courts: boolean;
          cancellation_policy: Json | null;
          cancelled_at: string | null;
          cover_image_url: string | null;
          created_at: string;
          currency: string;
          current_participants: number;
          deposit_cents: number | null;
          description: string | null;
          end_date: string | null;
          facility_id: string | null;
          id: string;
          installment_count: number | null;
          max_participants: number | null;
          metadata: Json | null;
          min_participants: number | null;
          name: string;
          organization_id: string;
          price_cents: number;
          published_at: string | null;
          registration_deadline: string | null;
          registration_opens_at: string | null;
          skill_level_max: string | null;
          skill_level_min: string | null;
          sport_id: string | null;
          start_date: string;
          status: Database['public']['Enums']['program_status_enum'];
          type: Database['public']['Enums']['program_type_enum'];
          updated_at: string;
          waitlist_enabled: boolean;
          waitlist_limit: number | null;
        };
        Insert: {
          age_max?: number | null;
          age_min?: number | null;
          allow_installments?: boolean;
          auto_block_courts?: boolean;
          cancellation_policy?: Json | null;
          cancelled_at?: string | null;
          cover_image_url?: string | null;
          created_at?: string;
          currency?: string;
          current_participants?: number;
          deposit_cents?: number | null;
          description?: string | null;
          end_date?: string | null;
          facility_id?: string | null;
          id?: string;
          installment_count?: number | null;
          max_participants?: number | null;
          metadata?: Json | null;
          min_participants?: number | null;
          name: string;
          organization_id: string;
          price_cents: number;
          published_at?: string | null;
          registration_deadline?: string | null;
          registration_opens_at?: string | null;
          skill_level_max?: string | null;
          skill_level_min?: string | null;
          sport_id?: string | null;
          start_date: string;
          status?: Database['public']['Enums']['program_status_enum'];
          type?: Database['public']['Enums']['program_type_enum'];
          updated_at?: string;
          waitlist_enabled?: boolean;
          waitlist_limit?: number | null;
        };
        Update: {
          age_max?: number | null;
          age_min?: number | null;
          allow_installments?: boolean;
          auto_block_courts?: boolean;
          cancellation_policy?: Json | null;
          cancelled_at?: string | null;
          cover_image_url?: string | null;
          created_at?: string;
          currency?: string;
          current_participants?: number;
          deposit_cents?: number | null;
          description?: string | null;
          end_date?: string | null;
          facility_id?: string | null;
          id?: string;
          installment_count?: number | null;
          max_participants?: number | null;
          metadata?: Json | null;
          min_participants?: number | null;
          name?: string;
          organization_id?: string;
          price_cents?: number;
          published_at?: string | null;
          registration_deadline?: string | null;
          registration_opens_at?: string | null;
          skill_level_max?: string | null;
          skill_level_min?: string | null;
          sport_id?: string | null;
          start_date?: string;
          status?: Database['public']['Enums']['program_status_enum'];
          type?: Database['public']['Enums']['program_type_enum'];
          updated_at?: string;
          waitlist_enabled?: boolean;
          waitlist_limit?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'program_facility_id_fkey';
            columns: ['facility_id'];
            isOneToOne: false;
            referencedRelation: 'facility';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organization';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      program_instructor: {
        Row: {
          created_at: string;
          id: string;
          instructor_id: string;
          is_primary: boolean;
          program_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          instructor_id: string;
          is_primary?: boolean;
          program_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          instructor_id?: string;
          is_primary?: boolean;
          program_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'program_instructor_instructor_id_fkey';
            columns: ['instructor_id'];
            isOneToOne: false;
            referencedRelation: 'instructor_profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_instructor_program_id_fkey';
            columns: ['program_id'];
            isOneToOne: false;
            referencedRelation: 'program';
            referencedColumns: ['id'];
          },
        ];
      };
      program_registration: {
        Row: {
          cancelled_at: string | null;
          confirmed_at: string | null;
          created_at: string;
          currency: string;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          id: string;
          notes: string | null;
          paid_amount_cents: number;
          payment_plan: Database['public']['Enums']['payment_plan_enum'];
          player_id: string;
          program_id: string;
          refund_amount_cents: number;
          refunded_at: string | null;
          registered_at: string;
          registered_by: string;
          status: Database['public']['Enums']['registration_status_enum'];
          stripe_customer_id: string | null;
          total_amount_cents: number;
          updated_at: string;
        };
        Insert: {
          cancelled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          id?: string;
          notes?: string | null;
          paid_amount_cents?: number;
          payment_plan?: Database['public']['Enums']['payment_plan_enum'];
          player_id: string;
          program_id: string;
          refund_amount_cents?: number;
          refunded_at?: string | null;
          registered_at?: string;
          registered_by: string;
          status?: Database['public']['Enums']['registration_status_enum'];
          stripe_customer_id?: string | null;
          total_amount_cents: number;
          updated_at?: string;
        };
        Update: {
          cancelled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          id?: string;
          notes?: string | null;
          paid_amount_cents?: number;
          payment_plan?: Database['public']['Enums']['payment_plan_enum'];
          player_id?: string;
          program_id?: string;
          refund_amount_cents?: number;
          refunded_at?: string | null;
          registered_at?: string;
          registered_by?: string;
          status?: Database['public']['Enums']['registration_status_enum'];
          stripe_customer_id?: string | null;
          total_amount_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'program_registration_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_registration_program_id_fkey';
            columns: ['program_id'];
            isOneToOne: false;
            referencedRelation: 'program';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_registration_registered_by_fkey';
            columns: ['registered_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      program_session: {
        Row: {
          cancelled_at: string | null;
          created_at: string;
          date: string;
          end_time: string;
          id: string;
          is_cancelled: boolean;
          location_override: string | null;
          notes: string | null;
          program_id: string;
          start_time: string;
          updated_at: string;
        };
        Insert: {
          cancelled_at?: string | null;
          created_at?: string;
          date: string;
          end_time: string;
          id?: string;
          is_cancelled?: boolean;
          location_override?: string | null;
          notes?: string | null;
          program_id: string;
          start_time: string;
          updated_at?: string;
        };
        Update: {
          cancelled_at?: string | null;
          created_at?: string;
          date?: string;
          end_time?: string;
          id?: string;
          is_cancelled?: boolean;
          location_override?: string | null;
          notes?: string | null;
          program_id?: string;
          start_time?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'program_session_program_id_fkey';
            columns: ['program_id'];
            isOneToOne: false;
            referencedRelation: 'program';
            referencedColumns: ['id'];
          },
        ];
      };
      program_session_court: {
        Row: {
          booking_id: string | null;
          court_id: string;
          created_at: string;
          id: string;
          session_id: string;
        };
        Insert: {
          booking_id?: string | null;
          court_id: string;
          created_at?: string;
          id?: string;
          session_id: string;
        };
        Update: {
          booking_id?: string | null;
          court_id?: string;
          created_at?: string;
          id?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'program_session_court_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'booking';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_session_court_court_id_fkey';
            columns: ['court_id'];
            isOneToOne: false;
            referencedRelation: 'court';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_session_court_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'program_session';
            referencedColumns: ['id'];
          },
        ];
      };
      program_waitlist: {
        Row: {
          added_by: string;
          created_at: string;
          id: string;
          notes: string | null;
          notification_sent_at: string | null;
          player_id: string;
          position: number;
          program_id: string;
          promoted_at: string | null;
          promotion_expires_at: string | null;
          registration_id: string | null;
          updated_at: string;
        };
        Insert: {
          added_by: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          notification_sent_at?: string | null;
          player_id: string;
          position: number;
          program_id: string;
          promoted_at?: string | null;
          promotion_expires_at?: string | null;
          registration_id?: string | null;
          updated_at?: string;
        };
        Update: {
          added_by?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          notification_sent_at?: string | null;
          player_id?: string;
          position?: number;
          program_id?: string;
          promoted_at?: string | null;
          promotion_expires_at?: string | null;
          registration_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'program_waitlist_added_by_fkey';
            columns: ['added_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_waitlist_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_waitlist_program_id_fkey';
            columns: ['program_id'];
            isOneToOne: false;
            referencedRelation: 'program';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'program_waitlist_registration_id_fkey';
            columns: ['registration_id'];
            isOneToOne: false;
            referencedRelation: 'program_registration';
            referencedColumns: ['id'];
          },
        ];
      };
      rating_proof: {
        Row: {
          created_at: string;
          description: string | null;
          external_url: string | null;
          file_id: string | null;
          id: string;
          is_active: boolean;
          player_rating_score_id: string;
          proof_type: Database['public']['Enums']['proof_type_enum'];
          rating_score_id: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database['public']['Enums']['proof_status_enum'];
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          external_url?: string | null;
          file_id?: string | null;
          id?: string;
          is_active?: boolean;
          player_rating_score_id: string;
          proof_type: Database['public']['Enums']['proof_type_enum'];
          rating_score_id?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['proof_status_enum'];
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          external_url?: string | null;
          file_id?: string | null;
          id?: string;
          is_active?: boolean;
          player_rating_score_id?: string;
          proof_type?: Database['public']['Enums']['proof_type_enum'];
          rating_score_id?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['proof_status_enum'];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rating_proof_file_id_fkey';
            columns: ['file_id'];
            isOneToOne: false;
            referencedRelation: 'file';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rating_proof_player_rating_score_id_fkey';
            columns: ['player_rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'player_rating_score';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rating_proof_rating_score_id_fkey';
            columns: ['rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'rating_score';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rating_proof_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      rating_reference_request: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          message: string | null;
          player_rating_score_id: string;
          rating_supported: boolean;
          referee_id: string;
          requester_id: string;
          responded_at: string | null;
          response_message: string | null;
          status: Database['public']['Enums']['rating_request_status_enum'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          message?: string | null;
          player_rating_score_id: string;
          rating_supported?: boolean;
          referee_id: string;
          requester_id: string;
          responded_at?: string | null;
          response_message?: string | null;
          status?: Database['public']['Enums']['rating_request_status_enum'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          message?: string | null;
          player_rating_score_id?: string;
          rating_supported?: boolean;
          referee_id?: string;
          requester_id?: string;
          responded_at?: string | null;
          response_message?: string | null;
          status?: Database['public']['Enums']['rating_request_status_enum'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rating_reference_requests_player_rating_score_id_fkey';
            columns: ['player_rating_score_id'];
            isOneToOne: false;
            referencedRelation: 'player_rating_score';
            referencedColumns: ['id'];
          },
        ];
      };
      rating_score: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          label: string;
          max_value: number | null;
          min_value: number | null;
          rating_system_id: string;
          skill_level: Database['public']['Enums']['skill_level'] | null;
          updated_at: string;
          value: number | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          label: string;
          max_value?: number | null;
          min_value?: number | null;
          rating_system_id: string;
          skill_level?: Database['public']['Enums']['skill_level'] | null;
          updated_at?: string;
          value?: number | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          label?: string;
          max_value?: number | null;
          min_value?: number | null;
          rating_system_id?: string;
          skill_level?: Database['public']['Enums']['skill_level'] | null;
          updated_at?: string;
          value?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rating_scores_rating_system_id_fkey';
            columns: ['rating_system_id'];
            isOneToOne: false;
            referencedRelation: 'rating_system';
            referencedColumns: ['id'];
          },
        ];
      };
      rating_system: {
        Row: {
          code: Database['public']['Enums']['rating_system_code_enum'];
          created_at: string;
          default_initial_value: number | null;
          description: string | null;
          id: string;
          is_active: boolean;
          max_value: number;
          min_for_referral: number | null;
          min_value: number;
          name: string;
          sport_id: string;
          step: number;
          updated_at: string;
        };
        Insert: {
          code: Database['public']['Enums']['rating_system_code_enum'];
          created_at?: string;
          default_initial_value?: number | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          max_value: number;
          min_for_referral?: number | null;
          min_value: number;
          name: string;
          sport_id: string;
          step?: number;
          updated_at?: string;
        };
        Update: {
          code?: Database['public']['Enums']['rating_system_code_enum'];
          created_at?: string;
          default_initial_value?: number | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          max_value?: number;
          min_for_referral?: number | null;
          min_value?: number;
          name?: string;
          sport_id?: string;
          step?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rating_systems_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      reference_request: {
        Row: {
          claimed_rating_score_id: string;
          completed_at: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          referee_comment: string | null;
          referee_id: string;
          reference_rating_score_id: string | null;
          reference_rating_value: number | null;
          requester_id: string;
          responded_at: string | null;
          sport_id: string;
          status: string;
        };
        Insert: {
          claimed_rating_score_id: string;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          referee_comment?: string | null;
          referee_id: string;
          reference_rating_score_id?: string | null;
          reference_rating_value?: number | null;
          requester_id: string;
          responded_at?: string | null;
          sport_id: string;
          status?: string;
        };
        Update: {
          claimed_rating_score_id?: string;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          referee_comment?: string | null;
          referee_id?: string;
          reference_rating_score_id?: string | null;
          reference_rating_value?: number | null;
          requester_id?: string;
          responded_at?: string | null;
          sport_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reference_request_referee_id_fkey';
            columns: ['referee_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reference_request_requester_id_fkey';
            columns: ['requester_id'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
        ];
      };
      registration_payment: {
        Row: {
          amount_cents: number;
          created_at: string;
          currency: string;
          due_date: string;
          failed_at: string | null;
          failure_reason: string | null;
          id: string;
          installment_number: number;
          next_retry_at: string | null;
          paid_at: string | null;
          refund_amount_cents: number | null;
          refunded_at: string | null;
          registration_id: string;
          retry_count: number;
          status: Database['public']['Enums']['registration_payment_status_enum'];
          stripe_charge_id: string | null;
          stripe_customer_id: string | null;
          stripe_payment_intent_id: string | null;
          total_installments: number;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          currency?: string;
          due_date: string;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          installment_number?: number;
          next_retry_at?: string | null;
          paid_at?: string | null;
          refund_amount_cents?: number | null;
          refunded_at?: string | null;
          registration_id: string;
          retry_count?: number;
          status?: Database['public']['Enums']['registration_payment_status_enum'];
          stripe_charge_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_payment_intent_id?: string | null;
          total_installments?: number;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          currency?: string;
          due_date?: string;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          installment_number?: number;
          next_retry_at?: string | null;
          paid_at?: string | null;
          refund_amount_cents?: number | null;
          refunded_at?: string | null;
          registration_id?: string;
          retry_count?: number;
          status?: Database['public']['Enums']['registration_payment_status_enum'];
          stripe_charge_id?: string | null;
          stripe_customer_id?: string | null;
          stripe_payment_intent_id?: string | null;
          total_installments?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'registration_payment_registration_id_fkey';
            columns: ['registration_id'];
            isOneToOne: false;
            referencedRelation: 'program_registration';
            referencedColumns: ['id'];
          },
        ];
      };
      report: {
        Row: {
          created_at: string | null;
          description: string | null;
          id: string;
          match_id: string | null;
          reason: Database['public']['Enums']['report_reason'];
          reported_id: string;
          reporter_id: string;
          resolution_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database['public']['Enums']['report_status'] | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          id?: string;
          match_id?: string | null;
          reason: Database['public']['Enums']['report_reason'];
          reported_id: string;
          reporter_id: string;
          resolution_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['report_status'] | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          id?: string;
          match_id?: string | null;
          reason?: Database['public']['Enums']['report_reason'];
          reported_id?: string;
          reporter_id?: string;
          resolution_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database['public']['Enums']['report_status'] | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'report_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'report_reported_id_fkey';
            columns: ['reported_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'report_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      reputation_config: {
        Row: {
          created_at: string;
          decay_enabled: boolean;
          decay_half_life_days: number | null;
          default_impact: number;
          event_type: Database['public']['Enums']['reputation_event_type'];
          id: string;
          is_active: boolean;
          max_impact: number | null;
          min_impact: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          decay_enabled?: boolean;
          decay_half_life_days?: number | null;
          default_impact: number;
          event_type: Database['public']['Enums']['reputation_event_type'];
          id?: string;
          is_active?: boolean;
          max_impact?: number | null;
          min_impact?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          decay_enabled?: boolean;
          decay_half_life_days?: number | null;
          default_impact?: number;
          event_type?: Database['public']['Enums']['reputation_event_type'];
          id?: string;
          is_active?: boolean;
          max_impact?: number | null;
          min_impact?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      reputation_event: {
        Row: {
          base_impact: number;
          caused_by_player_id: string | null;
          created_at: string;
          event_occurred_at: string;
          event_type: Database['public']['Enums']['reputation_event_type'];
          id: string;
          match_id: string | null;
          metadata: Json | null;
          player_id: string;
        };
        Insert: {
          base_impact: number;
          caused_by_player_id?: string | null;
          created_at?: string;
          event_occurred_at?: string;
          event_type: Database['public']['Enums']['reputation_event_type'];
          id?: string;
          match_id?: string | null;
          metadata?: Json | null;
          player_id: string;
        };
        Update: {
          base_impact?: number;
          caused_by_player_id?: string | null;
          created_at?: string;
          event_occurred_at?: string;
          event_type?: Database['public']['Enums']['reputation_event_type'];
          id?: string;
          match_id?: string | null;
          metadata?: Json | null;
          player_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reputation_event_caused_by_player_id_fkey';
            columns: ['caused_by_player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reputation_event_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'match';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reputation_event_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      score_confirmation: {
        Row: {
          action: string;
          confirmed_at: string;
          id: string;
          match_result_id: string;
          player_id: string;
          reason: string | null;
        };
        Insert: {
          action?: string;
          confirmed_at?: string;
          id?: string;
          match_result_id: string;
          player_id: string;
          reason?: string | null;
        };
        Update: {
          action?: string;
          confirmed_at?: string;
          id?: string;
          match_result_id?: string;
          player_id?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'score_confirmation_match_result_id_fkey';
            columns: ['match_result_id'];
            isOneToOne: false;
            referencedRelation: 'match_result';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'score_confirmation_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      screen_analytics: {
        Row: {
          created_at: string;
          duration_seconds: number | null;
          id: string;
          metadata: Json | null;
          player_id: string | null;
          screen_name: string;
          sport_id: string | null;
          view_ended_at: string | null;
          view_started_at: string;
        };
        Insert: {
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          metadata?: Json | null;
          player_id?: string | null;
          screen_name: string;
          sport_id?: string | null;
          view_ended_at?: string | null;
          view_started_at?: string;
        };
        Update: {
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          metadata?: Json | null;
          player_id?: string | null;
          screen_name?: string;
          sport_id?: string | null;
          view_ended_at?: string | null;
          view_started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'screen_analytics_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'screen_analytics_sport_id_fkey';
            columns: ['sport_id'];
            isOneToOne: false;
            referencedRelation: 'sport';
            referencedColumns: ['id'];
          },
        ];
      };
      session_attendance: {
        Row: {
          attended: boolean | null;
          created_at: string;
          id: string;
          marked_at: string | null;
          marked_by: string | null;
          notes: string | null;
          registration_id: string;
          session_id: string;
        };
        Insert: {
          attended?: boolean | null;
          created_at?: string;
          id?: string;
          marked_at?: string | null;
          marked_by?: string | null;
          notes?: string | null;
          registration_id: string;
          session_id: string;
        };
        Update: {
          attended?: boolean | null;
          created_at?: string;
          id?: string;
          marked_at?: string | null;
          marked_by?: string | null;
          notes?: string | null;
          registration_id?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_attendance_marked_by_fkey';
            columns: ['marked_by'];
            isOneToOne: false;
            referencedRelation: 'profile';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_attendance_registration_id_fkey';
            columns: ['registration_id'];
            isOneToOne: false;
            referencedRelation: 'program_registration';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_attendance_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'program_session';
            referencedColumns: ['id'];
          },
        ];
      };
      shared_contact: {
        Row: {
          created_at: string;
          device_contact_id: string | null;
          email: string | null;
          id: string;
          list_id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          source: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          device_contact_id?: string | null;
          email?: string | null;
          id?: string;
          list_id: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          source?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          device_contact_id?: string | null;
          email?: string | null;
          id?: string;
          list_id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shared_contact_list_id_fkey';
            columns: ['list_id'];
            isOneToOne: false;
            referencedRelation: 'shared_contact_list';
            referencedColumns: ['id'];
          },
        ];
      };
      shared_contact_list: {
        Row: {
          contact_count: number;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          player_id: string;
          updated_at: string;
        };
        Insert: {
          contact_count?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          player_id: string;
          updated_at?: string;
        };
        Update: {
          contact_count?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          player_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shared_contact_list_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'player';
            referencedColumns: ['id'];
          },
        ];
      };
      sport: {
        Row: {
          attributes: Json | null;
          created_at: string;
          description: string | null;
          display_name: string;
          icon_url: string | null;
          id: string;
          is_active: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          attributes?: Json | null;
          created_at?: string;
          description?: string | null;
          display_name: string;
          icon_url?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          attributes?: Json | null;
          created_at?: string;
          description?: string | null;
          display_name?: string;
          icon_url?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      verification_code: {
        Row: {
          code: string;
          created_at: string | null;
          email: string;
          expires_at: string;
          id: string;
          ip_address: string | null;
          used: boolean | null;
          used_at: string | null;
          user_agent: string | null;
        };
        Insert: {
          code: string;
          created_at?: string | null;
          email: string;
          expires_at: string;
          id?: string;
          ip_address?: string | null;
          used?: boolean | null;
          used_at?: string | null;
          user_agent?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string | null;
          email?: string;
          expires_at?: string;
          id?: string;
          ip_address?: string | null;
          used?: boolean | null;
          used_at?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      waitlist_signup: {
        Row: {
          created_at: string | null;
          email: string;
          id: number;
          ip_address: string | null;
          location: string | null;
          name: string;
          phone: string | null;
        };
        Insert: {
          created_at?: string | null;
          email: string;
          id?: never;
          ip_address?: string | null;
          location?: string | null;
          name: string;
          phone?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string;
          id?: never;
          ip_address?: string | null;
          location?: string | null;
          name?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_community_member: {
        Args: {
          p_approver_id?: string;
          p_community_id: string;
          p_member_id: string;
        };
        Returns: boolean;
      };
      auto_confirm_expired_scores: { Args: never; Returns: number };
      calculate_reputation_tier: {
        Args: { min_events?: number; score: number; total_events: number };
        Returns: Database['public']['Enums']['reputation_tier'];
      };
      check_community_access: {
        Args: { p_community_id: string; p_player_id?: string };
        Returns: {
          access_reason: string;
          can_access: boolean;
          has_active_moderator: boolean;
          is_member: boolean;
          is_public: boolean;
          membership_role: string;
          membership_status: string;
        }[];
      };
      check_peer_verification_threshold: {
        Args: { p_player_id: string; p_sport_id: string; p_threshold?: number };
        Returns: {
          average_rating: number;
          peer_count: number;
          recommended_rating_score_id: string;
          should_create_verified: boolean;
        }[];
      };
      confirm_match_score: {
        Args: { p_match_result_id: string; p_player_id: string };
        Returns: boolean;
      };
      count_current_level_proofs: {
        Args: { p_player_rating_score_id: string };
        Returns: number;
      };
      debug_check_conversation_participant: {
        Args: { p_conversation_id: string; p_player_id: string };
        Returns: {
          is_participant: boolean;
          participant_count: number;
        }[];
      };
      dismiss_alert: {
        Args: { p_admin_id: string; p_alert_id: string };
        Returns: boolean;
      };
      dispute_match_score: {
        Args: {
          p_match_result_id: string;
          p_player_id: string;
          p_reason?: string;
        };
        Returns: boolean;
      };
      expire_old_reference_requests: { Args: never; Returns: number };
      generate_daily_analytics_snapshot: { Args: never; Returns: undefined };
      generate_unique_invite_code: { Args: never; Returns: string };
      generate_weekly_matches_for_all_players: {
        Args: { p_target_match_count_per_player?: number };
        Returns: {
          matches_created: number;
          player_id: string;
          player_name: string;
        }[];
      };
      generate_weekly_matches_for_player: {
        Args: { p_player_id: string; p_target_match_count?: number };
        Returns: {
          end_time: string;
          facility_name: string;
          host_name: string;
          match_date: string;
          match_id: string;
          sport_name: string;
          start_time: string;
        }[];
      };
      get_active_player_ban: {
        Args: { p_player_id: string };
        Returns: {
          ban_type: Database['public']['Enums']['ban_type_enum'];
          banned_at: string;
          banned_by_admin_id: string;
          expires_at: string;
          id: string;
          reason: string;
        }[];
      };
      get_admin_alerts: {
        Args: { p_admin_id: string; p_include_read?: boolean; p_limit?: number };
        Returns: {
          action_url: string;
          alert_type: string;
          created_at: string;
          id: string;
          is_read: boolean;
          message: string;
          metadata: Json;
          read_at: string;
          severity: string;
          source_id: string;
          source_type: string;
          title: string;
        }[];
      };
      get_admin_audit_log: {
        Args: {
          p_action_type?: string;
          p_admin_id?: string;
          p_end_date?: string;
          p_entity_type?: string;
          p_limit?: number;
          p_offset?: number;
          p_severity?: string;
          p_start_date?: string;
        };
        Returns: {
          action_type: string;
          admin_email: string;
          admin_id: string;
          admin_name: string;
          admin_role: string;
          created_at: string;
          entity_id: string;
          entity_name: string;
          entity_type: string;
          id: string;
          metadata: Json;
          new_data: Json;
          old_data: Json;
          severity: string;
        }[];
      };
      get_admin_push_tokens: {
        Args: { p_alert_type: string; p_severity?: string };
        Returns: {
          admin_id: string;
          platform: string;
          push_token: string;
        }[];
      };
      get_alert_counts: {
        Args: { p_admin_id: string };
        Returns: {
          critical: number;
          info: number;
          total: number;
          warning: number;
        }[];
      };
      get_audit_log_stats: {
        Args: { p_days?: number };
        Returns: {
          actions_by_admin: Json;
          actions_by_severity: Json;
          actions_by_type: Json;
          daily_counts: Json;
          total_actions: number;
        }[];
      };
      get_available_slots: {
        Args: { p_court_id: string; p_date: string };
        Returns: {
          end_time: string;
          price_cents: number;
          start_time: string;
          template_source: string;
        }[];
      };
      get_available_slots_batch: {
        Args: { p_court_ids: string[]; p_date_from: string; p_date_to: string };
        Returns: {
          out_court_id: string;
          out_end_time: string;
          out_price_cents: number;
          out_slot_date: string;
          out_start_time: string;
          out_template_source: string;
        }[];
      };
      get_ban_statistics: {
        Args: never;
        Returns: {
          bans_this_month: number;
          permanent_bans: number;
          recidivism_rate: number;
          temporary_bans: number;
          total_active_bans: number;
        }[];
      };
      get_certification_funnel: {
        Args: never;
        Returns: {
          completion_rate: number;
          step_name: string;
          users_count: number;
        }[];
      };
      get_compatible_players: {
        Args: {
          p_max_results?: number;
          p_player_id: string;
          p_rating_tolerance?: number;
          p_sport_id: string;
        };
        Returns: {
          display_name: string;
          facility_id: string;
          facility_name: string;
          player_id: string;
          rating_difference: number;
          rating_value: number;
        }[];
      };
      get_conversation_health: {
        Args: never;
        Returns: {
          active_conversations: number;
          avg_messages_per_conversation: number;
          avg_response_time_minutes: number;
          total_conversations: number;
        }[];
      };
      get_effective_templates: {
        Args: { p_court_id: string; p_date: string };
        Returns: {
          end_time: string;
          price_cents: number;
          slot_duration_minutes: number;
          start_time: string;
          template_source: string;
        }[];
      };
      get_engagement_distribution: {
        Args: never;
        Returns: {
          engagement_level: string;
          percentage: number;
          user_count: number;
        }[];
      };
      get_feature_adoption: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: {
          adoption_rate: number;
          feature_name: string;
          users_count: number;
        }[];
      };
      get_feedback_sentiment: {
        Args: never;
        Returns: {
          category: string;
          count: number;
          percentage: number;
          status_breakdown: Json;
        }[];
      };
      get_group_activity: {
        Args: { p_limit?: number; p_network_id: string };
        Returns: {
          activity_type: string;
          created_at: string;
          id: string;
          metadata: Json;
          network_id: string;
          player_avatar_url: string;
          player_first_name: string;
          player_id: string;
          player_last_name: string;
          related_entity_id: string;
        }[];
      };
      get_latest_metric: {
        Args: {
          p_metric_name: string;
          p_metric_type: string;
          p_sport_id?: string;
        };
        Returns: number;
      };
      get_match_analytics: {
        Args: { p_end_date: string; p_sport_id?: string; p_start_date: string };
        Returns: {
          avg_participants: number;
          cancellation_rate: number;
          completion_rate: number;
          date: string;
          matches_completed: number;
          matches_created: number;
        }[];
      };
      get_match_chat_adoption: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: {
          avg_messages_per_match: number;
          chat_adoption_rate: number;
          matches_with_chat: number;
          total_matches: number;
        }[];
      };
      get_match_duration_types: {
        Args: never;
        Returns: {
          label: string;
          value: string;
        }[];
      };
      get_match_statistics: {
        Args: { p_days?: number; p_sport_id?: string };
        Returns: {
          avg_participants: number;
          cancelled_matches: number;
          completed_matches: number;
          scheduled_matches: number;
          total_matches: number;
        }[];
      };
      get_match_type_types: {
        Args: never;
        Returns: {
          label: string;
          value: string;
        }[];
      };
      get_matches_ready_for_closure: {
        Args: { batch_limit?: number; cutoff_hours?: number };
        Returns: {
          format: Database['public']['Enums']['match_format_enum'];
          id: string;
        }[];
      };
      get_message_volume: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: {
          date: string;
          direct_messages: number;
          group_messages: number;
          match_messages: number;
          total_messages: number;
        }[];
      };
      get_metric_trend: {
        Args: {
          p_days?: number;
          p_metric_name: string;
          p_metric_type: string;
          p_sport_id?: string;
        };
        Returns: {
          metric_value: number;
          snapshot_date: string;
        }[];
      };
      get_network_growth: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: {
          cumulative_networks: number;
          date: string;
          members_joined: number;
          networks_created: number;
        }[];
      };
      get_network_match_integration: {
        Args: never;
        Returns: {
          avg_matches_per_network: number;
          networks_with_matches: number;
          total_networks: number;
          total_shared_matches: number;
        }[];
      };
      get_network_size_distribution: {
        Args: never;
        Returns: {
          network_count: number;
          percentage: number;
          size_category: string;
        }[];
      };
      get_onboarding_funnel:
        | {
            Args: { p_days?: number };
            Returns: {
              avg_time_seconds: number;
              completion_rate: number;
              completions: number;
              screen_name: string;
              total_views: number;
            }[];
          }
        | {
            Args: { p_end_date: string; p_start_date: string };
            Returns: {
              avg_time_seconds: number;
              completion_rate: number;
              step_name: string;
              users_count: number;
            }[];
          };
      get_opponents_for_notification: {
        Args: { p_match_id: string; p_player_id: string };
        Returns: {
          display_name: string;
          first_name: string;
          player_id: string;
        }[];
      };
      get_or_create_group_invite_code: {
        Args: { group_id: string };
        Returns: string;
      };
      get_org_notification_recipients: {
        Args: {
          p_channel?: Database['public']['Enums']['delivery_channel_enum'];
          p_notification_type: Database['public']['Enums']['notification_type_enum'];
          p_organization_id: string;
        };
        Returns: {
          email: string;
          full_name: string;
          user_id: string;
        }[];
      };
      get_participants_for_feedback_reminder: {
        Args: { p_cutoff_end: string; p_cutoff_start: string };
        Returns: {
          end_time: string;
          format: string;
          match_date: string;
          match_id: string;
          participant_id: string;
          player_id: string;
          sport_name: string;
          start_time: string;
          timezone: string;
        }[];
      };
      get_participants_for_initial_feedback_notification: {
        Args: { p_cutoff_end: string; p_cutoff_start: string };
        Returns: {
          end_time: string;
          format: string;
          match_date: string;
          match_id: string;
          participant_id: string;
          player_id: string;
          sport_name: string;
          start_time: string;
          timezone: string;
        }[];
      };
      get_peer_rating_activity: {
        Args: never;
        Returns: {
          avg_rating_difference: number;
          completed_requests: number;
          completion_rate: number;
          total_requests: number;
        }[];
      };
      get_pending_community_members: {
        Args: { p_community_id: string; p_moderator_id?: string };
        Returns: {
          added_by: string;
          created_at: string;
          id: string;
          player_id: string;
          player_name: string;
          player_profile_picture: string;
          referrer_name: string;
          request_type: Database['public']['Enums']['network_member_request_type'];
        }[];
      };
      get_pending_reports_count: {
        Args: never;
        Returns: {
          high_priority: number;
          pending: number;
          total: number;
          under_review: number;
        }[];
      };
      get_pending_score_confirmations: {
        Args: { p_player_id: string };
        Returns: {
          confirmation_deadline: string;
          match_date: string;
          match_id: string;
          match_result_id: string;
          network_id: string;
          network_name: string;
          opponent_avatar: string;
          opponent_name: string;
          player_team: number;
          sport_icon_url: string;
          sport_name: string;
          submitted_by_avatar: string;
          submitted_by_id: string;
          submitted_by_name: string;
          team1_score: number;
          team2_score: number;
          winning_team: number;
        }[];
      };
      get_player_communities: {
        Args: { p_player_id: string };
        Returns: {
          cover_image_url: string;
          created_at: string;
          created_by: string;
          description: string;
          id: string;
          is_private: boolean;
          member_count: number;
          membership_role: string;
          membership_status: string;
          name: string;
        }[];
      };
      get_player_matches: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_player_id: string;
          p_sport_id?: string;
          p_status_filter?: string;
          p_time_filter?: string;
        };
        Returns: {
          match_id: string;
        }[];
      };
      get_player_online_status: {
        Args: { player_uuid: string };
        Returns: {
          is_online: boolean;
          last_seen: string;
        }[];
      };
      get_player_reports: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_priority?: string;
          p_report_type?: Database['public']['Enums']['report_type_enum'];
          p_reported_player_id?: string;
          p_status?: Database['public']['Enums']['report_status_enum'];
        };
        Returns: {
          action_taken: string;
          admin_notes: string;
          created_at: string;
          description: string;
          evidence_urls: string[];
          id: string;
          priority: string;
          related_match_id: string;
          report_type: Database['public']['Enums']['report_type_enum'];
          reported_player_avatar: string;
          reported_player_id: string;
          reported_player_name: string;
          reporter_avatar: string;
          reporter_id: string;
          reporter_name: string;
          resulting_ban_id: string;
          reviewed_at: string;
          reviewed_by: string;
          reviewer_name: string;
          status: Database['public']['Enums']['report_status_enum'];
          updated_at: string;
        }[];
      };
      get_players_by_play_attributes: {
        Args: {
          p_play_attributes: Database['public']['Enums']['play_attribute_enum'][];
          p_sport_id: string;
        };
        Returns: {
          matching_attributes: number;
          play_attributes: Database['public']['Enums']['play_attribute_enum'][];
          play_style: Database['public']['Enums']['play_style_enum'];
          player_id: string;
        }[];
      };
      get_players_by_play_style: {
        Args: {
          p_play_style: Database['public']['Enums']['play_style_enum'];
          p_sport_id: string;
        };
        Returns: {
          play_attributes: Database['public']['Enums']['play_attribute_enum'][];
          play_style: Database['public']['Enums']['play_style_enum'];
          player_id: string;
        }[];
      };
      get_playing_hand_types: {
        Args: never;
        Returns: {
          label: string;
          value: string;
        }[];
      };
      get_proof_counts: {
        Args: { p_player_rating_score_id: string };
        Returns: {
          current_level_proofs_count: number;
          total_proofs_count: number;
        }[];
      };
      get_public_communities: {
        Args: { p_player_id?: string };
        Returns: {
          cover_image_url: string;
          created_at: string;
          created_by: string;
          description: string;
          id: string;
          is_member: boolean;
          member_count: number;
          membership_role: string;
          membership_status: string;
          name: string;
        }[];
      };
      get_rating_distribution: {
        Args: { p_sport_id?: string };
        Returns: {
          certified_count: number;
          percentage: number;
          player_count: number;
          rating_label: string;
        }[];
      };
      get_rating_scores_by_type: {
        Args: {
          p_rating_system_code: Database['public']['Enums']['rating_system_code_enum'];
          p_sport_name: string;
        };
        Returns: {
          description: string;
          display_label: string;
          id: string;
          score_value: number;
          skill_level: Database['public']['Enums']['skill_level'];
        }[];
      };
      get_rating_systems_for_sport: {
        Args: { p_sport_name: string };
        Returns: {
          code: Database['public']['Enums']['rating_system_code_enum'];
          default_initial_value: number;
          description: string;
          id: string;
          is_active: boolean;
          max_value: number;
          min_value: number;
          name: string;
          step: number;
        }[];
      };
      get_realtime_user_count: {
        Args: never;
        Returns: {
          active_month: number;
          active_today: number;
          active_week: number;
          new_today: number;
          new_week: number;
          total_users: number;
        }[];
      };
      get_report_types: {
        Args: never;
        Returns: {
          count: number;
          percentage: number;
          report_type: string;
        }[];
      };
      get_report_volume: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: {
          date: string;
          reports_created: number;
          reports_resolved: number;
          resolution_rate: number;
        }[];
      };
      get_reputation_distribution: {
        Args: never;
        Returns: {
          avg_score: number;
          percentage: number;
          tier: string;
          user_count: number;
        }[];
      };
      get_reputation_events: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: {
          date: string;
          negative_events: number;
          positive_events: number;
          total_events: number;
        }[];
      };
      get_reputation_summary: {
        Args: { target_player_id: string };
        Returns: {
          is_public: boolean;
          matches_completed: number;
          negative_events: number;
          positive_events: number;
          score: number;
          tier: Database['public']['Enums']['reputation_tier'];
          total_events: number;
        }[];
      };
      get_resolution_metrics: {
        Args: never;
        Returns: {
          avg_resolution_hours: number;
          escalation_rate: number;
          pending_reports: number;
          resolved_within_sla_rate: number;
        }[];
      };
      get_retention_cohort: {
        Args: { p_cohort_weeks?: number };
        Returns: {
          cohort_week: string;
          retained_users: number;
          retention_rate: number;
          week_number: number;
        }[];
      };
      get_screen_analytics: {
        Args: { p_end_date: string; p_limit?: number; p_start_date: string };
        Returns: {
          avg_duration_seconds: number;
          screen_name: string;
          unique_users: number;
          view_count: number;
        }[];
      };
      get_session_metrics: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: {
          avg_screens_per_session: number;
          avg_session_duration: number;
          date: string;
          total_sessions: number;
          unique_users: number;
        }[];
      };
      get_sport_activity_comparison: {
        Args: { p_end_date?: string; p_start_date?: string };
        Returns: {
          matches_completed: number;
          sport_id: string;
          sport_name: string;
          total_matches: number;
          unique_players: number;
        }[];
      };
      get_sport_distribution:
        | {
            Args: never;
            Returns: {
              percentage: number;
              player_count: number;
              sport_id: string;
              sport_name: string;
            }[];
          }
        | {
            Args: { p_end_date?: string; p_start_date?: string };
            Returns: {
              percentage: number;
              sport_id: string;
              sport_name: string;
              user_count: number;
            }[];
          };
      get_sport_facility_data: {
        Args: { p_sport_id?: string };
        Returns: {
          avg_utilization: number;
          cities_count: number;
          court_count: number;
          facility_count: number;
          peak_hours: string;
          sport_id: string;
          sport_name: string;
        }[];
      };
      get_sport_growth_trends: {
        Args: {
          p_end_date?: string;
          p_sport_id?: string;
          p_start_date?: string;
        };
        Returns: {
          new_matches: number;
          new_players: number;
          sport_id: string;
          sport_name: string;
          trend_date: string;
        }[];
      };
      get_sport_popularity: {
        Args: never;
        Returns: {
          active_last_30_days: number;
          growth_percent: number;
          match_count: number;
          percentage: number;
          player_count: number;
          sport_id: string;
          sport_name: string;
        }[];
      };
      get_time_slot_starts: {
        Args: { p_duration_minutes: number; p_period: string };
        Returns: string[];
      };
      get_top_network_activity: {
        Args: { p_limit?: number };
        Returns: {
          activity_count: number;
          last_activity_at: string;
          member_count: number;
          network_id: string;
          network_name: string;
        }[];
      };
      get_user_conversation_ids: {
        Args: { user_id: string };
        Returns: string[];
      };
      get_user_created_match_ids: {
        Args: { p_player_id: string };
        Returns: string[];
      };
      get_user_growth_trend: {
        Args: { p_end_date: string; p_interval?: string; p_start_date: string };
        Returns: {
          cumulative_users: number;
          growth_rate: number;
          new_users: number;
          period: string;
        }[];
      };
      get_user_participating_match_ids: {
        Args: { p_player_id: string };
        Returns: string[];
      };
      insert_notification:
        | {
            Args: {
              p_body?: string;
              p_expires_at?: string;
              p_organization_id?: string;
              p_payload?: Json;
              p_priority?: Database['public']['Enums']['notification_priority_enum'];
              p_scheduled_at?: string;
              p_target_id?: string;
              p_title?: string;
              p_type: Database['public']['Enums']['notification_type_enum'];
              p_user_id: string;
            };
            Returns: {
              body: string | null;
              created_at: string;
              expires_at: string | null;
              id: string;
              organization_id: string | null;
              payload: Json | null;
              priority: Database['public']['Enums']['notification_priority_enum'] | null;
              read_at: string | null;
              scheduled_at: string | null;
              target_id: string | null;
              title: string;
              type: Database['public']['Enums']['notification_type_enum'];
              updated_at: string;
              user_id: string;
            };
            SetofOptions: {
              from: '*';
              to: 'notification';
              isOneToOne: true;
              isSetofReturn: false;
            };
          }
        | {
            Args: {
              p_body?: string;
              p_expires_at?: string;
              p_payload?: Json;
              p_priority?: string;
              p_scheduled_at?: string;
              p_target_id?: string;
              p_title?: string;
              p_type: string;
              p_user_id: string;
            };
            Returns: {
              body: string | null;
              created_at: string;
              expires_at: string | null;
              id: string;
              organization_id: string | null;
              payload: Json | null;
              priority: Database['public']['Enums']['notification_priority_enum'] | null;
              read_at: string | null;
              scheduled_at: string | null;
              target_id: string | null;
              title: string;
              type: Database['public']['Enums']['notification_type_enum'];
              updated_at: string;
              user_id: string;
            };
            SetofOptions: {
              from: '*';
              to: 'notification';
              isOneToOne: true;
              isSetofReturn: false;
            };
          };
      insert_notifications: {
        Args: { p_notifications: Json };
        Returns: {
          body: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          organization_id: string | null;
          payload: Json | null;
          priority: Database['public']['Enums']['notification_priority_enum'] | null;
          read_at: string | null;
          scheduled_at: string | null;
          target_id: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type_enum'];
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'notification';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      is_match_creator: {
        Args: { p_match_id: string; p_player_id: string };
        Returns: boolean;
      };
      is_match_participant: {
        Args: { p_match_id: string; p_player_id: string };
        Returns: boolean;
      };
      is_network_creator: {
        Args: { network_id_param: string; user_id_param: string };
        Returns: boolean;
      };
      is_network_member: {
        Args: { network_id_param: string; user_id_param: string };
        Returns: boolean;
      };
      is_network_moderator: {
        Args: { network_id_param: string; user_id_param: string };
        Returns: boolean;
      };
      is_player_banned: { Args: { p_player_id: string }; Returns: boolean };
      is_player_online: { Args: { player_uuid: string }; Returns: boolean };
      is_public_match: { Args: { p_match_id: string }; Returns: boolean };
      join_group_by_invite_code: {
        Args: { p_invite_code: string; p_player_id: string };
        Returns: Json;
      };
      log_admin_action:
        | {
            Args: {
              p_action_type: Database['public']['Enums']['admin_action_type_enum'];
              p_admin_id: string;
              p_entity_id?: string;
              p_entity_type: Database['public']['Enums']['admin_entity_type_enum'];
              p_metadata?: Json;
              p_new_data?: Json;
              p_old_data?: Json;
            };
            Returns: string;
          }
        | {
            Args: {
              p_action_type: string;
              p_admin_id: string;
              p_entity_id?: string;
              p_entity_name?: string;
              p_entity_type: string;
              p_metadata?: Json;
              p_new_data?: Json;
              p_old_data?: Json;
              p_severity?: string;
            };
            Returns: string;
          };
      mark_alert_read: {
        Args: { p_admin_id: string; p_alert_id: string };
        Returns: boolean;
      };
      mark_feedback_reminders_sent: {
        Args: { p_participant_ids: string[] };
        Returns: number;
      };
      mark_initial_feedback_notifications_sent: {
        Args: { p_participant_ids: string[] };
        Returns: number;
      };
      parse_match_duration_to_minutes: {
        Args: { p_duration: string };
        Returns: number;
      };
      recalculate_player_reputation: {
        Args: {
          apply_decay?: boolean;
          min_events_for_public?: number;
          target_player_id: string;
        };
        Returns: {
          calculated_at: string;
          created_at: string;
          is_public: boolean;
          last_decay_calculation: string | null;
          matches_completed: number;
          negative_events: number;
          player_id: string;
          positive_events: number;
          reputation_score: number;
          reputation_tier: Database['public']['Enums']['reputation_tier'];
          total_events: number;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'player_reputation';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      refer_player_to_community: {
        Args: {
          p_community_id: string;
          p_referred_player_id: string;
          p_referrer_id?: string;
        };
        Returns: string;
      };
      register_admin_device: {
        Args: {
          p_admin_id: string;
          p_device_name?: string;
          p_platform: string;
          p_push_token: string;
        };
        Returns: string;
      };
      reject_community_member: {
        Args: {
          p_community_id: string;
          p_member_id: string;
          p_rejector_id?: string;
        };
        Returns: boolean;
      };
      request_to_join_community: {
        Args: { p_community_id: string; p_player_id?: string };
        Returns: string;
      };
      reset_group_invite_code: {
        Args: { p_group_id: string; p_moderator_id: string };
        Returns: string;
      };
      review_player_report: {
        Args: {
          p_action_taken?: string;
          p_admin_id: string;
          p_admin_notes?: string;
          p_ban_id?: string;
          p_report_id: string;
          p_status: Database['public']['Enums']['report_status_enum'];
        };
        Returns: boolean;
      };
      search_conversation_messages: {
        Args: { p_conversation_id: string; p_limit?: number; p_query: string };
        Returns: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          rank: number;
          sender_id: string;
        }[];
      };
      search_facilities_nearby: {
        Args: {
          p_court_types?: string[];
          p_facility_types?: string[];
          p_has_lighting?: boolean;
          p_latitude: number;
          p_limit?: number;
          p_longitude: number;
          p_max_distance_km?: number;
          p_membership_required?: boolean;
          p_offset?: number;
          p_search_query?: string;
          p_sport_ids: string[];
          p_surface_types?: string[];
        };
        Returns: {
          address: string;
          booking_url_template: string;
          city: string;
          data_provider_id: string;
          data_provider_type: string;
          distance_meters: number;
          external_provider_id: string;
          facility_type: string;
          id: string;
          name: string;
          sport_ids: string[];
          timezone: string;
        }[];
      };
      search_facilities_nearby_count: {
        Args: {
          p_court_types?: string[];
          p_facility_types?: string[];
          p_has_lighting?: boolean;
          p_latitude: number;
          p_longitude: number;
          p_max_distance_km?: number;
          p_membership_required?: boolean;
          p_search_query?: string;
          p_sport_ids: string[];
          p_surface_types?: string[];
        };
        Returns: number;
      };
      search_matches_nearby: {
        Args: {
          p_latitude: number;
          p_limit?: number;
          p_longitude: number;
          p_max_distance_km: number;
          p_offset?: number;
          p_sport_id: string;
          p_user_gender?: string;
        };
        Returns: {
          distance_meters: number;
          match_id: string;
        }[];
      };
      search_public_matches:
        | {
            Args: {
              p_cost?: string;
              p_court_status?: string;
              p_date_range?: string;
              p_duration?: string;
              p_facility_id?: string;
              p_format?: string;
              p_gender?: string;
              p_join_mode?: string;
              p_latitude: number;
              p_limit?: number;
              p_longitude: number;
              p_match_type?: string;
              p_max_distance_km: number;
              p_offset?: number;
              p_search_query?: string;
              p_skill_level?: string;
              p_specific_date?: string;
              p_sport_id: string;
              p_time_of_day?: string;
              p_user_gender?: string;
            };
            Returns: {
              distance_meters: number;
              match_id: string;
            }[];
          }
        | {
            Args: {
              p_cost?: string;
              p_court_status?: string;
              p_date_range?: string;
              p_duration?: string;
              p_facility_id?: string;
              p_format?: string;
              p_gender?: string;
              p_join_mode?: string;
              p_latitude: number;
              p_limit?: number;
              p_longitude: number;
              p_match_tier?: string;
              p_match_type?: string;
              p_max_distance_km: number;
              p_offset?: number;
              p_search_query?: string;
              p_skill_level?: string;
              p_specific_date?: string;
              p_sport_id: string;
              p_time_of_day?: string;
              p_user_gender?: string;
            };
            Returns: {
              distance_meters: number;
              match_id: string;
            }[];
          };
      seed_org_notification_defaults: {
        Args: { p_organization_id: string };
        Returns: undefined;
      };
      send_admin_broadcast_push: {
        Args: {
          p_admin_ids?: string[];
          p_alert_type?: string;
          p_message: string;
          p_severity?: string;
          p_title: string;
        };
        Returns: Json;
      };
      submit_match_result_for_match:
        | {
            Args: {
              p_match_id: string;
              p_sets: Json;
              p_submitted_by: string;
              p_winning_team: number;
            };
            Returns: string;
          }
        | {
            Args: {
              p_match_id: string;
              p_partner_id?: string;
              p_sets: Json;
              p_submitted_by: string;
              p_winning_team: number;
            };
            Returns: string;
          };
      trigger_weekly_match_generation: {
        Args: { p_target_match_count?: number };
        Returns: Json;
      };
      unregister_admin_device: {
        Args: { p_admin_id: string; p_push_token: string };
        Returns: boolean;
      };
      update_registration_paid_amount: {
        Args: { p_registration_id: string };
        Returns: number;
      };
    };
    Enums: {
      account_status: 'active' | 'suspended' | 'deleted' | 'pending_verification';
      admin_action_type_enum:
        | 'view'
        | 'create'
        | 'update'
        | 'delete'
        | 'ban'
        | 'unban'
        | 'export'
        | 'login'
        | 'logout'
        | 'settings_change';
      admin_entity_type_enum:
        | 'player'
        | 'profile'
        | 'match'
        | 'organization'
        | 'facility'
        | 'report'
        | 'conversation'
        | 'network'
        | 'admin'
        | 'system';
      admin_role_enum: 'super_admin' | 'moderator' | 'support' | 'analyst';
      app_role_enum: 'player' | 'organization_member' | 'admin';
      availability_block_type_enum:
        | 'manual'
        | 'maintenance'
        | 'holiday'
        | 'weather'
        | 'private_event';
      availability_enum:
        | 'available'
        | 'unavailable'
        | 'maintenance'
        | 'reserved'
        | 'under_maintenance'
        | 'closed';
      badge_status_enum: 'self_declared' | 'certified' | 'disputed';
      ban_type_enum: 'temporary' | 'permanent';
      booking_status:
        | 'pending'
        | 'confirmed'
        | 'cancelled'
        | 'completed'
        | 'no_show'
        | 'awaiting_approval';
      booking_type_enum: 'player' | 'program_session' | 'maintenance';
      cancellation_reason_enum: 'weather' | 'court_unavailable' | 'emergency' | 'other';
      conversation_type: 'direct' | 'group' | 'match' | 'announcement';
      cost_split_type_enum: 'host_pays' | 'split_equal' | 'custom';
      country_enum: 'Canada' | 'United States';
      court_status_enum: 'reserved' | 'to_reserve';
      court_surface: 'hard' | 'clay' | 'grass' | 'carpet' | 'synthetic';
      court_type: 'indoor' | 'outdoor' | 'covered';
      day_enum: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
      day_of_week:
        | 'monday'
        | 'tuesday'
        | 'wednesday'
        | 'thursday'
        | 'friday'
        | 'saturday'
        | 'sunday';
      delivery_channel_enum: 'email' | 'sms' | 'push';
      delivery_status_enum:
        | 'pending'
        | 'success'
        | 'failed'
        | 'skipped_preference'
        | 'skipped_missing_contact';
      facility_contact_type_enum: 'general' | 'reservation' | 'maintenance' | 'other';
      facility_type_enum:
        | 'park'
        | 'club'
        | 'indoor_center'
        | 'private'
        | 'other'
        | 'community_club'
        | 'municipal'
        | 'university'
        | 'school'
        | 'community_center';
      file_type_enum: 'image' | 'video' | 'document' | 'audio' | 'other';
      gender_enum: 'male' | 'female' | 'other';
      invite_source_enum:
        | 'manual'
        | 'auto_match'
        | 'invite_list'
        | 'mailing_list'
        | 'growth_prompt';
      invite_status_enum: 'pending' | 'sent' | 'accepted' | 'expired' | 'bounced' | 'cancelled';
      locale_enum: 'en-US' | 'en-CA' | 'fr-CA' | 'fr-FR';
      location_type_enum: 'facility' | 'custom' | 'tbd';
      match_duration_enum: '30' | '60' | '90' | '120' | 'custom';
      match_format_enum: 'singles' | 'doubles';
      match_join_mode_enum: 'direct' | 'request';
      match_outcome_enum: 'played' | 'mutual_cancel' | 'opponent_no_show';
      match_participant_status_enum:
        | 'pending'
        | 'requested'
        | 'joined'
        | 'declined'
        | 'left'
        | 'kicked'
        | 'waitlisted'
        | 'refused'
        | 'cancelled';
      match_report_priority_enum: 'high' | 'medium' | 'low';
      match_report_reason_enum:
        | 'harassment'
        | 'unsportsmanlike'
        | 'safety'
        | 'misrepresented_level'
        | 'inappropriate';
      match_report_status_enum: 'pending' | 'reviewed' | 'dismissed' | 'action_taken';
      match_type_enum: 'casual' | 'competitive' | 'both';
      match_visibility_enum: 'public' | 'private';
      member_role: 'owner' | 'admin' | 'manager' | 'staff' | 'member';
      member_status: 'active' | 'inactive' | 'pending' | 'suspended';
      message_status: 'sent' | 'delivered' | 'read' | 'failed';
      network_member_request_type:
        | 'direct_add'
        | 'join_request'
        | 'member_referral'
        | 'invite_code';
      network_member_role_enum: 'member' | 'moderator';
      network_member_status: 'active' | 'pending' | 'blocked' | 'removed';
      network_visibility: 'public' | 'private' | 'friends' | 'club';
      notification_priority_enum: 'low' | 'normal' | 'high' | 'urgent';
      notification_status: 'unread' | 'read' | 'archived';
      notification_type:
        | 'match_request'
        | 'match_confirmation'
        | 'match_cancellation'
        | 'message'
        | 'friend_request'
        | 'system';
      notification_type_enum:
        | 'match_invitation'
        | 'reminder'
        | 'payment'
        | 'support'
        | 'chat'
        | 'system'
        | 'match_join_request'
        | 'match_join_accepted'
        | 'match_join_rejected'
        | 'match_player_joined'
        | 'match_cancelled'
        | 'match_updated'
        | 'match_starting_soon'
        | 'match_completed'
        | 'player_kicked'
        | 'player_left'
        | 'new_message'
        | 'friend_request'
        | 'rating_verified'
        | 'feedback_request'
        | 'score_confirmation'
        | 'feedback_reminder'
        | 'booking_created'
        | 'booking_cancelled_by_player'
        | 'booking_modified'
        | 'new_member_joined'
        | 'member_left'
        | 'member_role_changed'
        | 'payment_received'
        | 'payment_failed'
        | 'refund_processed'
        | 'daily_summary'
        | 'weekly_report'
        | 'booking_confirmed'
        | 'booking_reminder'
        | 'booking_cancelled_by_org'
        | 'membership_approved'
        | 'org_announcement'
        | 'match_new_available'
        | 'program_registration_confirmed'
        | 'program_registration_cancelled'
        | 'program_session_reminder'
        | 'program_session_cancelled'
        | 'program_waitlist_promoted'
        | 'program_payment_due'
        | 'program_payment_received';
      organization_nature_enum: 'public' | 'private';
      organization_type: 'club' | 'facility' | 'league' | 'academy' | 'association';
      organization_type_enum: 'club' | 'municipality' | 'city' | 'association';
      payment_method: 'credit_card' | 'debit_card' | 'paypal' | 'cash' | 'bank_transfer';
      payment_plan_enum: 'full' | 'installment';
      payment_status: 'pending' | 'completed' | 'failed' | 'refunded';
      period_enum: 'morning' | 'afternoon' | 'evening';
      play_attribute_enum:
        | 'serve_speed_and_placement'
        | 'net_play'
        | 'court_coverage'
        | 'forehand_power'
        | 'shot_selection'
        | 'spin_control';
      play_style_enum: 'counterpuncher' | 'aggressive_baseliner' | 'serve_and_volley' | 'all_court';
      playing_hand: 'left' | 'right' | 'both';
      playing_hand_enum: 'right' | 'left' | 'both';
      program_status_enum: 'draft' | 'published' | 'cancelled' | 'completed';
      program_type_enum: 'program' | 'lesson';
      proof_status_enum: 'pending' | 'approved' | 'rejected';
      proof_type_enum: 'external_link' | 'file';
      rating_certification_method_enum: 'admin' | 'external_rating' | 'proof' | 'referrals';
      rating_request_status_enum: 'pending' | 'completed' | 'declined' | 'expired' | 'cancelled';
      rating_source_type:
        | 'self_reported'
        | 'api_verified'
        | 'peer_verified'
        | 'admin_verified'
        | 'reference_verified';
      rating_system_code_enum: 'ntrp' | 'utr' | 'self_tennis' | 'dupr' | 'self_pickle';
      registration_payment_status_enum:
        | 'pending'
        | 'succeeded'
        | 'failed'
        | 'refunded'
        | 'cancelled';
      registration_status_enum: 'pending' | 'confirmed' | 'cancelled' | 'refunded';
      report_reason: 'inappropriate_behavior' | 'harassment' | 'spam' | 'cheating' | 'other';
      report_status: 'pending' | 'under_review' | 'resolved' | 'dismissed';
      report_status_enum: 'pending' | 'under_review' | 'dismissed' | 'action_taken' | 'escalated';
      report_type_enum:
        | 'harassment'
        | 'cheating'
        | 'inappropriate_content'
        | 'spam'
        | 'impersonation'
        | 'no_show'
        | 'unsportsmanlike'
        | 'other';
      reputation_event_type:
        | 'match_completed'
        | 'match_no_show'
        | 'match_ghosted'
        | 'match_on_time'
        | 'match_late'
        | 'match_cancelled_early'
        | 'match_cancelled_late'
        | 'match_repeat_opponent'
        | 'review_received_5star'
        | 'review_received_4star'
        | 'review_received_3star'
        | 'review_received_2star'
        | 'review_received_1star'
        | 'report_received'
        | 'report_dismissed'
        | 'report_upheld'
        | 'warning_issued'
        | 'suspension_lifted'
        | 'peer_rating_given'
        | 'first_match_bonus'
        | 'feedback_submitted'
        | 'match_left_late';
      reputation_tier: 'unknown' | 'bronze' | 'silver' | 'gold' | 'platinum';
      role_enum: 'admin' | 'staff' | 'player' | 'coach' | 'owner';
      share_channel_enum: 'sms' | 'email' | 'whatsapp' | 'share_sheet' | 'copy_link';
      share_status_enum: 'pending' | 'sent' | 'viewed' | 'accepted' | 'expired' | 'cancelled';
      skill_level: 'beginner' | 'intermediate' | 'advanced' | 'professional';
      storage_provider_enum: 'supabase' | 'backblaze';
      surface_type_enum:
        | 'hard'
        | 'clay'
        | 'grass'
        | 'synthetic'
        | 'carpet'
        | 'concrete'
        | 'asphalt';
      time_period: 'morning' | 'afternoon' | 'evening' | 'night';
      user_role: 'player' | 'admin' | 'super_admin';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_status: ['active', 'suspended', 'deleted', 'pending_verification'],
      admin_action_type_enum: [
        'view',
        'create',
        'update',
        'delete',
        'ban',
        'unban',
        'export',
        'login',
        'logout',
        'settings_change',
      ],
      admin_entity_type_enum: [
        'player',
        'profile',
        'match',
        'organization',
        'facility',
        'report',
        'conversation',
        'network',
        'admin',
        'system',
      ],
      admin_role_enum: ['super_admin', 'moderator', 'support', 'analyst'],
      app_role_enum: ['player', 'organization_member', 'admin'],
      availability_block_type_enum: [
        'manual',
        'maintenance',
        'holiday',
        'weather',
        'private_event',
      ],
      availability_enum: [
        'available',
        'unavailable',
        'maintenance',
        'reserved',
        'under_maintenance',
        'closed',
      ],
      badge_status_enum: ['self_declared', 'certified', 'disputed'],
      ban_type_enum: ['temporary', 'permanent'],
      booking_status: [
        'pending',
        'confirmed',
        'cancelled',
        'completed',
        'no_show',
        'awaiting_approval',
      ],
      booking_type_enum: ['player', 'program_session', 'maintenance'],
      cancellation_reason_enum: ['weather', 'court_unavailable', 'emergency', 'other'],
      conversation_type: ['direct', 'group', 'match', 'announcement'],
      cost_split_type_enum: ['host_pays', 'split_equal', 'custom'],
      country_enum: ['Canada', 'United States'],
      court_status_enum: ['reserved', 'to_reserve'],
      court_surface: ['hard', 'clay', 'grass', 'carpet', 'synthetic'],
      court_type: ['indoor', 'outdoor', 'covered'],
      day_enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      day_of_week: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      delivery_channel_enum: ['email', 'sms', 'push'],
      delivery_status_enum: [
        'pending',
        'success',
        'failed',
        'skipped_preference',
        'skipped_missing_contact',
      ],
      facility_contact_type_enum: ['general', 'reservation', 'maintenance', 'other'],
      facility_type_enum: [
        'park',
        'club',
        'indoor_center',
        'private',
        'other',
        'community_club',
        'municipal',
        'university',
        'school',
        'community_center',
      ],
      file_type_enum: ['image', 'video', 'document', 'audio', 'other'],
      gender_enum: ['male', 'female', 'other'],
      invite_source_enum: ['manual', 'auto_match', 'invite_list', 'mailing_list', 'growth_prompt'],
      invite_status_enum: ['pending', 'sent', 'accepted', 'expired', 'bounced', 'cancelled'],
      locale_enum: ['en-US', 'en-CA', 'fr-CA', 'fr-FR'],
      location_type_enum: ['facility', 'custom', 'tbd'],
      match_duration_enum: ['30', '60', '90', '120', 'custom'],
      match_format_enum: ['singles', 'doubles'],
      match_join_mode_enum: ['direct', 'request'],
      match_outcome_enum: ['played', 'mutual_cancel', 'opponent_no_show'],
      match_participant_status_enum: [
        'pending',
        'requested',
        'joined',
        'declined',
        'left',
        'kicked',
        'waitlisted',
        'refused',
        'cancelled',
      ],
      match_report_priority_enum: ['high', 'medium', 'low'],
      match_report_reason_enum: [
        'harassment',
        'unsportsmanlike',
        'safety',
        'misrepresented_level',
        'inappropriate',
      ],
      match_report_status_enum: ['pending', 'reviewed', 'dismissed', 'action_taken'],
      match_type_enum: ['casual', 'competitive', 'both'],
      match_visibility_enum: ['public', 'private'],
      member_role: ['owner', 'admin', 'manager', 'staff', 'member'],
      member_status: ['active', 'inactive', 'pending', 'suspended'],
      message_status: ['sent', 'delivered', 'read', 'failed'],
      network_member_request_type: ['direct_add', 'join_request', 'member_referral', 'invite_code'],
      network_member_role_enum: ['member', 'moderator'],
      network_member_status: ['active', 'pending', 'blocked', 'removed'],
      network_visibility: ['public', 'private', 'friends', 'club'],
      notification_priority_enum: ['low', 'normal', 'high', 'urgent'],
      notification_status: ['unread', 'read', 'archived'],
      notification_type: [
        'match_request',
        'match_confirmation',
        'match_cancellation',
        'message',
        'friend_request',
        'system',
      ],
      notification_type_enum: [
        'match_invitation',
        'reminder',
        'payment',
        'support',
        'chat',
        'system',
        'match_join_request',
        'match_join_accepted',
        'match_join_rejected',
        'match_player_joined',
        'match_cancelled',
        'match_updated',
        'match_starting_soon',
        'match_completed',
        'player_kicked',
        'player_left',
        'new_message',
        'friend_request',
        'rating_verified',
        'feedback_request',
        'score_confirmation',
        'feedback_reminder',
        'booking_created',
        'booking_cancelled_by_player',
        'booking_modified',
        'new_member_joined',
        'member_left',
        'member_role_changed',
        'payment_received',
        'payment_failed',
        'refund_processed',
        'daily_summary',
        'weekly_report',
        'booking_confirmed',
        'booking_reminder',
        'booking_cancelled_by_org',
        'membership_approved',
        'org_announcement',
        'match_new_available',
        'program_registration_confirmed',
        'program_registration_cancelled',
        'program_session_reminder',
        'program_session_cancelled',
        'program_waitlist_promoted',
        'program_payment_due',
        'program_payment_received',
      ],
      organization_nature_enum: ['public', 'private'],
      organization_type: ['club', 'facility', 'league', 'academy', 'association'],
      organization_type_enum: ['club', 'municipality', 'city', 'association'],
      payment_method: ['credit_card', 'debit_card', 'paypal', 'cash', 'bank_transfer'],
      payment_plan_enum: ['full', 'installment'],
      payment_status: ['pending', 'completed', 'failed', 'refunded'],
      period_enum: ['morning', 'afternoon', 'evening'],
      play_attribute_enum: [
        'serve_speed_and_placement',
        'net_play',
        'court_coverage',
        'forehand_power',
        'shot_selection',
        'spin_control',
      ],
      play_style_enum: ['counterpuncher', 'aggressive_baseliner', 'serve_and_volley', 'all_court'],
      playing_hand: ['left', 'right', 'both'],
      playing_hand_enum: ['right', 'left', 'both'],
      program_status_enum: ['draft', 'published', 'cancelled', 'completed'],
      program_type_enum: ['program', 'lesson'],
      proof_status_enum: ['pending', 'approved', 'rejected'],
      proof_type_enum: ['external_link', 'file'],
      rating_certification_method_enum: ['admin', 'external_rating', 'proof', 'referrals'],
      rating_request_status_enum: ['pending', 'completed', 'declined', 'expired', 'cancelled'],
      rating_source_type: [
        'self_reported',
        'api_verified',
        'peer_verified',
        'admin_verified',
        'reference_verified',
      ],
      rating_system_code_enum: ['ntrp', 'utr', 'self_tennis', 'dupr', 'self_pickle'],
      registration_payment_status_enum: ['pending', 'succeeded', 'failed', 'refunded', 'cancelled'],
      registration_status_enum: ['pending', 'confirmed', 'cancelled', 'refunded'],
      report_reason: ['inappropriate_behavior', 'harassment', 'spam', 'cheating', 'other'],
      report_status: ['pending', 'under_review', 'resolved', 'dismissed'],
      report_status_enum: ['pending', 'under_review', 'dismissed', 'action_taken', 'escalated'],
      report_type_enum: [
        'harassment',
        'cheating',
        'inappropriate_content',
        'spam',
        'impersonation',
        'no_show',
        'unsportsmanlike',
        'other',
      ],
      reputation_event_type: [
        'match_completed',
        'match_no_show',
        'match_ghosted',
        'match_on_time',
        'match_late',
        'match_cancelled_early',
        'match_cancelled_late',
        'match_repeat_opponent',
        'review_received_5star',
        'review_received_4star',
        'review_received_3star',
        'review_received_2star',
        'review_received_1star',
        'report_received',
        'report_dismissed',
        'report_upheld',
        'warning_issued',
        'suspension_lifted',
        'peer_rating_given',
        'first_match_bonus',
        'feedback_submitted',
        'match_left_late',
      ],
      reputation_tier: ['unknown', 'bronze', 'silver', 'gold', 'platinum'],
      role_enum: ['admin', 'staff', 'player', 'coach', 'owner'],
      share_channel_enum: ['sms', 'email', 'whatsapp', 'share_sheet', 'copy_link'],
      share_status_enum: ['pending', 'sent', 'viewed', 'accepted', 'expired', 'cancelled'],
      skill_level: ['beginner', 'intermediate', 'advanced', 'professional'],
      storage_provider_enum: ['supabase', 'backblaze'],
      surface_type_enum: ['hard', 'clay', 'grass', 'synthetic', 'carpet', 'concrete', 'asphalt'],
      time_period: ['morning', 'afternoon', 'evening', 'night'],
      user_role: ['player', 'admin', 'super_admin'],
    },
  },
} as const;
