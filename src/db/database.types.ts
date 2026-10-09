export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
      booking_events: {
        Row: {
          actor_kind: Database["public"]["Enums"]["actor_kind"];
          actor_user_id: string | null;
          booking_id: string;
          created_at: string;
          data: NonNullable<Json>;
          event: Database["public"]["Enums"]["booking_event_type"];
          from_status: Database["public"]["Enums"]["booking_status"] | null;
          id: number;
          tenant_id: string;
          to_status: Database["public"]["Enums"]["booking_status"] | null;
        };
        ComputedFields: never;
        Insert: {
          actor_kind: Database["public"]["Enums"]["actor_kind"];
          actor_user_id?: string | null;
          booking_id: string;
          created_at?: string;
          data?: NonNullable<Json>;
          event: Database["public"]["Enums"]["booking_event_type"];
          from_status?: Database["public"]["Enums"]["booking_status"] | null;
          id?: never;
          tenant_id: string;
          to_status?: Database["public"]["Enums"]["booking_status"] | null;
        };
        Update: {
          actor_kind?: Database["public"]["Enums"]["actor_kind"];
          actor_user_id?: string | null;
          booking_id?: string;
          created_at?: string;
          data?: NonNullable<Json>;
          event?: Database["public"]["Enums"]["booking_event_type"];
          from_status?: Database["public"]["Enums"]["booking_status"] | null;
          id?: never;
          tenant_id?: string;
          to_status?: Database["public"]["Enums"]["booking_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_events_tenant_id_booking_id_fkey";
            columns: ["tenant_id", "booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      bookings: {
        Row: {
          arrival_window: unknown;
          cancel_reason: string | null;
          cancellation_version_id: string;
          cancelled_at: string | null;
          client_id: string;
          completed_at: string | null;
          confirmed_at: string | null;
          created_at: string;
          created_by: string | null;
          crew_id: string;
          currency: string;
          deposit_cents: number;
          duration_minutes: number;
          id: string;
          number: number;
          occurrence_date: string | null;
          payment_due_by: string | null;
          pricing_version_id: string;
          property_id: string;
          quote: NonNullable<Json>;
          recurring_plan_id: string | null;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          status: Database["public"]["Enums"]["booking_status"];
          tenant_id: string;
          total_cents: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          arrival_window: unknown;
          cancel_reason?: string | null;
          cancellation_version_id: string;
          cancelled_at?: string | null;
          client_id: string;
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          crew_id: string;
          currency?: string;
          deposit_cents: number;
          duration_minutes: number;
          id?: string;
          number?: never;
          occurrence_date?: string | null;
          payment_due_by?: string | null;
          pricing_version_id: string;
          property_id: string;
          quote: NonNullable<Json>;
          recurring_plan_id?: string | null;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          status: Database["public"]["Enums"]["booking_status"];
          tenant_id: string;
          total_cents: number;
          updated_at?: string;
        };
        Update: {
          arrival_window?: unknown;
          cancel_reason?: string | null;
          cancellation_version_id?: string;
          cancelled_at?: string | null;
          client_id?: string;
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          crew_id?: string;
          currency?: string;
          deposit_cents?: number;
          duration_minutes?: number;
          id?: string;
          number?: never;
          occurrence_date?: string | null;
          payment_due_by?: string | null;
          pricing_version_id?: string;
          property_id?: string;
          quote?: NonNullable<Json>;
          recurring_plan_id?: string | null;
          service_id?: string;
          source?: Database["public"]["Enums"]["booking_source"];
          status?: Database["public"]["Enums"]["booking_status"];
          tenant_id?: string;
          total_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_tenant_id_cancellation_version_id_fkey";
            columns: ["tenant_id", "cancellation_version_id"];
            isOneToOne: false;
            referencedRelation: "rule_versions";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_client_id_property_id_fkey";
            columns: ["tenant_id", "client_id", "property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["tenant_id", "client_id", "id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_crew_id_fkey";
            columns: ["tenant_id", "crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_pricing_version_id_fkey";
            columns: ["tenant_id", "pricing_version_id"];
            isOneToOne: false;
            referencedRelation: "rule_versions";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_recurring_plan_id_fkey";
            columns: ["tenant_id", "recurring_plan_id"];
            isOneToOne: false;
            referencedRelation: "recurring_plans";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "bookings_tenant_id_service_id_fkey";
            columns: ["tenant_id", "service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      client_notes: {
        Row: {
          author_id: string | null;
          body: string;
          client_id: string;
          created_at: string;
          id: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          body: string;
          client_id: string;
          created_at?: string;
          id?: string;
          tenant_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          client_id?: string;
          created_at?: string;
          id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_notes_tenant_id_client_id_fkey";
            columns: ["tenant_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      clients: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          phone: string | null;
          source: Database["public"]["Enums"]["client_source"];
          tenant_id: string;
          updated_at: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          full_name: string;
          id?: string;
          phone?: string | null;
          source: Database["public"]["Enums"]["client_source"];
          tenant_id: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
          source?: Database["public"]["Enums"]["client_source"];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      crew_allocations: {
        Row: {
          booking_id: string | null;
          busy: unknown;
          created_at: string;
          crew_id: string;
          hold_expires_at: string | null;
          hold_token: string | null;
          id: string;
          kind: Database["public"]["Enums"]["allocation_kind"];
          note: string | null;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          booking_id?: string | null;
          busy: unknown;
          created_at?: string;
          crew_id: string;
          hold_expires_at?: string | null;
          hold_token?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["allocation_kind"];
          note?: string | null;
          tenant_id: string;
        };
        Update: {
          booking_id?: string | null;
          busy?: unknown;
          created_at?: string;
          crew_id?: string;
          hold_expires_at?: string | null;
          hold_token?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["allocation_kind"];
          note?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crew_allocations_tenant_id_booking_id_crew_id_fkey";
            columns: ["tenant_id", "booking_id", "crew_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["tenant_id", "id", "crew_id"];
          },
          {
            foreignKeyName: "crew_allocations_tenant_id_crew_id_fkey";
            columns: ["tenant_id", "crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "crew_allocations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      crew_members: {
        Row: {
          crew_id: string;
          tenant_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          crew_id: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          crew_id?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crew_members_tenant_id_crew_id_fkey";
            columns: ["tenant_id", "crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "crew_members_tenant_id_user_id_fkey";
            columns: ["tenant_id", "user_id"];
            isOneToOne: true;
            referencedRelation: "memberships";
            referencedColumns: ["tenant_id", "user_id"];
          },
        ];
      };
      crews: {
        Row: {
          active: boolean;
          color: string;
          created_at: string;
          id: string;
          name: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          tenant_id: string;
        };
        Update: {
          active?: boolean;
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crews_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      dispatch_alerts: {
        Row: {
          booking_id: string | null;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["alert_kind"];
          message: string;
          occurrence_date: string | null;
          plan_id: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          booking_id?: string | null;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["alert_kind"];
          message: string;
          occurrence_date?: string | null;
          plan_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          tenant_id: string;
        };
        Update: {
          booking_id?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["alert_kind"];
          message?: string;
          occurrence_date?: string | null;
          plan_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dispatch_alerts_tenant_id_booking_id_fkey";
            columns: ["tenant_id", "booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "dispatch_alerts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dispatch_alerts_tenant_id_plan_id_fkey";
            columns: ["tenant_id", "plan_id"];
            isOneToOne: false;
            referencedRelation: "recurring_plans";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["member_role"];
          tenant_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          role: Database["public"]["Enums"]["member_role"];
          tenant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["member_role"];
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      properties: {
        Row: {
          access_notes: string | null;
          address_line1: string;
          address_line2: string | null;
          bedrooms: number;
          city: string;
          client_id: string;
          created_at: string;
          full_baths: number;
          half_baths: number;
          has_pets: boolean;
          id: string;
          label: string;
          parking_notes: string | null;
          pet_notes: string | null;
          sqft: number | null;
          state: string;
          tenant_id: string;
          updated_at: string;
          zip: string;
        };
        ComputedFields: never;
        Insert: {
          access_notes?: string | null;
          address_line1: string;
          address_line2?: string | null;
          bedrooms: number;
          city: string;
          client_id: string;
          created_at?: string;
          full_baths: number;
          half_baths?: number;
          has_pets?: boolean;
          id?: string;
          label?: string;
          parking_notes?: string | null;
          pet_notes?: string | null;
          sqft?: number | null;
          state: string;
          tenant_id: string;
          updated_at?: string;
          zip: string;
        };
        Update: {
          access_notes?: string | null;
          address_line1?: string;
          address_line2?: string | null;
          bedrooms?: number;
          city?: string;
          client_id?: string;
          created_at?: string;
          full_baths?: number;
          half_baths?: number;
          has_pets?: boolean;
          id?: string;
          label?: string;
          parking_notes?: string | null;
          pet_notes?: string | null;
          sqft?: number | null;
          state?: string;
          tenant_id?: string;
          updated_at?: string;
          zip?: string;
        };
        Relationships: [
          {
            foreignKeyName: "properties_tenant_id_client_id_fkey";
            columns: ["tenant_id", "client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      recurring_plans: {
        Row: {
          client_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          duration_minutes: number;
          first_date: string;
          frequency: Database["public"]["Enums"]["plan_frequency"];
          id: string;
          materialized_through: string | null;
          paused_until: string | null;
          preferred_crew_id: string | null;
          price_cents: number;
          pricing_version_id: string;
          property_id: string;
          quote: NonNullable<Json>;
          service_id: string;
          status: Database["public"]["Enums"]["plan_status"];
          tenant_id: string;
          timezone: string;
          updated_at: string;
          window_end_local: string;
          window_start_local: string;
        };
        ComputedFields: never;
        Insert: {
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          duration_minutes: number;
          first_date: string;
          frequency: Database["public"]["Enums"]["plan_frequency"];
          id?: string;
          materialized_through?: string | null;
          paused_until?: string | null;
          preferred_crew_id?: string | null;
          price_cents: number;
          pricing_version_id: string;
          property_id: string;
          quote: NonNullable<Json>;
          service_id: string;
          status?: Database["public"]["Enums"]["plan_status"];
          tenant_id: string;
          timezone: string;
          updated_at?: string;
          window_end_local: string;
          window_start_local: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          duration_minutes?: number;
          first_date?: string;
          frequency?: Database["public"]["Enums"]["plan_frequency"];
          id?: string;
          materialized_through?: string | null;
          paused_until?: string | null;
          preferred_crew_id?: string | null;
          price_cents?: number;
          pricing_version_id?: string;
          property_id?: string;
          quote?: NonNullable<Json>;
          service_id?: string;
          status?: Database["public"]["Enums"]["plan_status"];
          tenant_id?: string;
          timezone?: string;
          updated_at?: string;
          window_end_local?: string;
          window_start_local?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_plans_tenant_id_client_id_property_id_fkey";
            columns: ["tenant_id", "client_id", "property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["tenant_id", "client_id", "id"];
          },
          {
            foreignKeyName: "recurring_plans_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_plans_tenant_id_preferred_crew_id_fkey";
            columns: ["tenant_id", "preferred_crew_id"];
            isOneToOne: false;
            referencedRelation: "crews";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "recurring_plans_tenant_id_pricing_version_id_fkey";
            columns: ["tenant_id", "pricing_version_id"];
            isOneToOne: false;
            referencedRelation: "rule_versions";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "recurring_plans_tenant_id_service_id_fkey";
            columns: ["tenant_id", "service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      rule_versions: {
        Row: {
          created_at: string;
          created_by: string | null;
          effective_from: string;
          id: string;
          kind: Database["public"]["Enums"]["rule_kind"];
          note: string;
          rules: NonNullable<Json>;
          tenant_id: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          id?: string;
          kind: Database["public"]["Enums"]["rule_kind"];
          note?: string;
          rules: NonNullable<Json>;
          tenant_id: string;
          version: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["rule_kind"];
          note?: string;
          rules?: NonNullable<Json>;
          tenant_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "rule_versions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          active: boolean;
          booking_mode: Database["public"]["Enums"]["booking_mode"];
          code: string;
          created_at: string;
          description: string;
          id: string;
          name: string;
          sort_order: number;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          booking_mode: Database["public"]["Enums"]["booking_mode"];
          code: string;
          created_at?: string;
          description?: string;
          id?: string;
          name: string;
          sort_order?: number;
          tenant_id: string;
        };
        Update: {
          active?: boolean;
          booking_mode?: Database["public"]["Enums"]["booking_mode"];
          code?: string;
          created_at?: string;
          description?: string;
          id?: string;
          name?: string;
          sort_order?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          contact_email: string | null;
          created_at: string;
          currency: string;
          id: string;
          is_demo: boolean;
          name: string;
          phone: string | null;
          slug: string;
          timezone: string;
        };
        ComputedFields: never;
        Insert: {
          contact_email?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          is_demo?: boolean;
          name: string;
          phone?: string | null;
          slug: string;
          timezone: string;
        };
        Update: {
          contact_email?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          is_demo?: boolean;
          name?: string;
          phone?: string | null;
          slug?: string;
          timezone?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cmd_add_time_off: {
        Args: {
          p_actor: string;
          p_crew_id: string;
          p_note?: string;
          p_period: unknown;
          p_tenant_id: string;
        };
        Returns: string;
      };
      cmd_cancel_booking: {
        Args: {
          p_actor: string;
          p_actor_kind: Database["public"]["Enums"]["actor_kind"];
          p_booking_id: string;
          p_fee_cents?: number;
          p_reason: string;
        };
        Returns: undefined;
      };
      cmd_create_booking: {
        Args: {
          p_actor: string;
          p_actor_kind: Database["public"]["Enums"]["actor_kind"];
          p_arrival_window: unknown;
          p_busy: unknown;
          p_cancellation_version_id: string;
          p_client: Json;
          p_crew_ids?: string[];
          p_deposit_cents: number;
          p_duration_minutes: number;
          p_hold_token?: string;
          p_occurrence_date?: string;
          p_payment_due_by?: string;
          p_pricing_version_id: string;
          p_property: Json;
          p_quote: Json;
          p_recurring_plan_id?: string;
          p_service_id: string;
          p_source: Database["public"]["Enums"]["booking_source"];
          p_status: Database["public"]["Enums"]["booking_status"];
          p_tenant_id: string;
          p_total_cents: number;
        };
        Returns: {
          booking_id: string;
          booking_number: number;
          client_id: string;
          crew_id: string;
          property_id: string;
        }[];
      };
      cmd_expire_stale: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bookings_expired: number;
          holds_removed: number;
        }[];
      };
      cmd_hold_slot: {
        Args: {
          p_actor?: string;
          p_busy: unknown;
          p_crew_ids: string[];
          p_hold_minutes: number;
          p_tenant_id: string;
        };
        Returns: {
          allocation_id: string;
          crew_id: string;
          hold_expires_at: string;
          hold_token: string;
        }[];
      };
      cmd_publish_rules: {
        Args: {
          p_actor: string;
          p_effective_from?: string;
          p_kind: Database["public"]["Enums"]["rule_kind"];
          p_note?: string;
          p_rules: Json;
          p_tenant_id: string;
        };
        Returns: {
          rule_version_id: string;
          version: number;
        }[];
      };
      cmd_reassign_booking: {
        Args: { p_actor: string; p_booking_id: string; p_crew_id: string };
        Returns: undefined;
      };
      cmd_release_hold: { Args: { p_hold_token: string }; Returns: boolean };
      cmd_remove_time_off: {
        Args: { p_actor: string; p_allocation_id: string };
        Returns: undefined;
      };
      cmd_reschedule_booking: {
        Args: {
          p_actor: string;
          p_actor_kind: Database["public"]["Enums"]["actor_kind"];
          p_arrival_window: unknown;
          p_booking_id: string;
          p_busy: unknown;
          p_crew_ids: string[];
          p_fee_cents?: number;
        };
        Returns: {
          booking_id: string;
          crew_id: string;
        }[];
      };
      public_busy: {
        Args: { p_from: string; p_tenant_id: string; p_to: string };
        Returns: {
          busy: unknown;
          crew_id: string;
        }[];
      };
    };
    Enums: {
      actor_kind: "guest" | "client" | "staff" | "crew" | "ai" | "system";
      alert_kind: "plan_conflict" | "handoff" | "payment_failed";
      allocation_kind: "hold" | "booking" | "time_off";
      booking_event_type:
        | "created"
        | "confirmed"
        | "rescheduled"
        | "reassigned"
        | "cancelled"
        | "completed"
        | "no_access"
        | "expired"
        | "payment_failed";
      booking_mode: "instant" | "quote_request" | "class";
      booking_source: "web" | "portal" | "admin" | "ai" | "plan";
      booking_status:
        | "pending_payment"
        | "confirmed"
        | "completed"
        | "no_access"
        | "cancelled"
        | "expired";
      client_source: "web" | "portal" | "admin" | "ai" | "import";
      member_role: "owner" | "dispatcher" | "cleaner";
      plan_frequency: "weekly" | "biweekly" | "monthly";
      plan_status: "active" | "paused" | "cancelled";
      rule_kind: "pricing" | "schedule" | "cancellation";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_kind: ["guest", "client", "staff", "crew", "ai", "system"],
      alert_kind: ["plan_conflict", "handoff", "payment_failed"],
      allocation_kind: ["hold", "booking", "time_off"],
      booking_event_type: [
        "created",
        "confirmed",
        "rescheduled",
        "reassigned",
        "cancelled",
        "completed",
        "no_access",
        "expired",
        "payment_failed",
      ],
      booking_mode: ["instant", "quote_request", "class"],
      booking_source: ["web", "portal", "admin", "ai", "plan"],
      booking_status: [
        "pending_payment",
        "confirmed",
        "completed",
        "no_access",
        "cancelled",
        "expired",
      ],
      client_source: ["web", "portal", "admin", "ai", "import"],
      member_role: ["owner", "dispatcher", "cleaner"],
      plan_frequency: ["weekly", "biweekly", "monthly"],
      plan_status: ["active", "paused", "cancelled"],
      rule_kind: ["pricing", "schedule", "cancellation"],
    },
  },
} as const;
