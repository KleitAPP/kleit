export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_deletions: {
        Row: {
          cancelled_at: string | null
          final_at: string
          requested_at: string
          state: Database["public"]["Enums"]["deletion_state"]
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          final_at?: string
          requested_at?: string
          state?: Database["public"]["Enums"]["deletion_state"]
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          final_at?: string
          requested_at?: string
          state?: Database["public"]["Enums"]["deletion_state"]
          user_id?: string
        }
        Relationships: []
      }
      age_confirmations: {
        Row: {
          confirmed_at: string
          id: string
          purge_after: string | null
          terms_version: string
          user_id_hash: string
        }
        Insert: {
          confirmed_at?: string
          id?: string
          purge_after?: string | null
          terms_version: string
          user_id_hash: string
        }
        Update: {
          confirmed_at?: string
          id?: string
          purge_after?: string | null
          terms_version?: string
          user_id_hash?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      blocked_identities: {
        Row: {
          created_at: string
          device_id_hash: string | null
          email_hash: string | null
          expires_at: string | null
          id: string
          provider_id_hash: string | null
          reason: string
        }
        Insert: {
          created_at?: string
          device_id_hash?: string | null
          email_hash?: string | null
          expires_at?: string | null
          id?: string
          provider_id_hash?: string | null
          reason: string
        }
        Update: {
          created_at?: string
          device_id_hash?: string | null
          email_hash?: string | null
          expires_at?: string | null
          id?: string
          provider_id_hash?: string | null
          reason?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
      }
      clicks: {
        Row: {
          click_id: string
          created_at: string
          item_id: string
          network: string
          set_id: string | null
        }
        Insert: {
          click_id?: string
          created_at?: string
          item_id: string
          network?: string
          set_id?: string | null
        }
        Update: {
          click_id?: string
          created_at?: string
          item_id?: string
          network?: string
          set_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clicks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clicks_set_fk"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      clip_records: {
        Row: {
          created_at: string
          id: string
          image_id: string | null
          item_id: string | null
          source_url: string | null
          trigger: Database["public"]["Enums"]["clip_trigger"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_id?: string | null
          item_id?: string | null
          source_url?: string | null
          trigger: Database["public"]["Enums"]["clip_trigger"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_id?: string | null
          item_id?: string | null
          source_url?: string | null
          trigger?: Database["public"]["Enums"]["clip_trigger"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clip_records_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      closet_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          item_id: string
          notes: string | null
          shareable: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id: string
          notes?: string | null
          shareable?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          item_id?: string
          notes?: string | null
          shareable?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "closet_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_entries: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          item_id: string | null
          set_id: string | null
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          item_id?: string | null
          set_id?: string | null
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          item_id?: string | null
          set_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_entries_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_entries_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
          visibility: Database["public"]["Enums"]["collection_visibility"]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["collection_visibility"]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["collection_visibility"]
        }
        Relationships: []
      }
      drawer_items: {
        Row: {
          created_at: string
          id: string
          item_id: string
          origin: Database["public"]["Enums"]["drawer_origin"]
          picked_up_from_set_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          origin: Database["public"]["Enums"]["drawer_origin"]
          picked_up_from_set_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          origin?: Database["public"]["Enums"]["drawer_origin"]
          picked_up_from_set_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawer_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_requests: {
        Row: {
          created_at: string
          requester_id: string
          target_id: string
        }
        Insert: {
          created_at?: string
          requester_id: string
          target_id: string
        }
        Update: {
          created_at?: string
          requester_id?: string
          target_id?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
        }
        Relationships: []
      }
      item_flags: {
        Row: {
          attempts: number
          created_at: string
          item_id: string
          labels: Json
          scan_state: Database["public"]["Enums"]["scan_state"]
          scanned_at: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          item_id: string
          labels?: Json
          scan_state?: Database["public"]["Enums"]["scan_state"]
          scanned_at?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          item_id?: string
          labels?: Json
          scan_state?: Database["public"]["Enums"]["scan_state"]
          scanned_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_flags_item_fk"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          alt_text: string | null
          color_name: string | null
          created_at: string
          credit: string | null
          deleted_at: string | null
          id: string
          image_bucket: Database["public"]["Enums"]["image_bucket"]
          image_hash: string | null
          image_id: string | null
          kind: Database["public"]["Enums"]["item_kind"]
          owner_id: string
          price_cents: number | null
          price_checked_at: string | null
          price_currency: string | null
          sold_out: boolean
          source_domain: string | null
          source_url: string | null
          store_name: string | null
          takedown_state: Database["public"]["Enums"]["takedown_state"]
          title: string | null
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          color_name?: string | null
          created_at?: string
          credit?: string | null
          deleted_at?: string | null
          id?: string
          image_bucket?: Database["public"]["Enums"]["image_bucket"]
          image_hash?: string | null
          image_id?: string | null
          kind: Database["public"]["Enums"]["item_kind"]
          owner_id: string
          price_cents?: number | null
          price_checked_at?: string | null
          price_currency?: string | null
          sold_out?: boolean
          source_domain?: string | null
          source_url?: string | null
          store_name?: string | null
          takedown_state?: Database["public"]["Enums"]["takedown_state"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          color_name?: string | null
          created_at?: string
          credit?: string | null
          deleted_at?: string | null
          id?: string
          image_bucket?: Database["public"]["Enums"]["image_bucket"]
          image_hash?: string | null
          image_id?: string | null
          kind?: Database["public"]["Enums"]["item_kind"]
          owner_id?: string
          price_cents?: number | null
          price_checked_at?: string | null
          price_currency?: string | null
          sold_out?: boolean
          source_domain?: string | null
          source_url?: string | null
          store_name?: string | null
          takedown_state?: Database["public"]["Enums"]["takedown_state"]
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      optout_sites: {
        Row: {
          added_at: string
          domain: string
          source: Database["public"]["Enums"]["optout_source"]
        }
        Insert: {
          added_at?: string
          domain: string
          source: Database["public"]["Enums"]["optout_source"]
        }
        Update: {
          added_at?: string
          domain?: string
          source?: Database["public"]["Enums"]["optout_source"]
        }
        Relationships: []
      }
      poll_options: {
        Row: {
          id: string
          label: string
          poll_id: string
          set_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          label?: string
          poll_id: string
          set_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          label?: string
          poll_id?: string
          set_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_options_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          closed_at: string | null
          closes_at: string
          created_at: string
          deleted_at: string | null
          id: string
          locked: boolean
          owner_id: string
          question: string
          share_code: string
          takedown_state: Database["public"]["Enums"]["takedown_state"]
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closes_at?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          locked?: boolean
          owner_id: string
          question?: string
          share_code?: string
          takedown_state?: Database["public"]["Enums"]["takedown_state"]
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closes_at?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          locked?: boolean
          owner_id?: string
          question?: string
          share_code?: string
          takedown_state?: Database["public"]["Enums"]["takedown_state"]
          updated_at?: string
        }
        Relationships: []
      }
      private_contact: {
        Row: {
          created_at: string
          phone_e164: string | null
          phone_hash: string | null
          phone_verified_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          phone_e164?: string | null
          phone_hash?: string | null
          phone_verified_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          phone_e164?: string | null
          phone_hash?: string | null
          phone_verified_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age_confirmed_at: string
          avatar_url: string | null
          bio: string
          created_at: string
          deactivated_at: string | null
          display_name: string
          findable_by_email: boolean
          findable_by_phone: boolean
          is_private: boolean
          style_vibes: string[]
          suggestable: boolean
          terms_version: string
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          age_confirmed_at: string
          avatar_url?: string | null
          bio?: string
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          findable_by_email?: boolean
          findable_by_phone?: boolean
          is_private?: boolean
          style_vibes?: string[]
          suggestable?: boolean
          terms_version: string
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          age_confirmed_at?: string
          avatar_url?: string | null
          bio?: string
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          findable_by_email?: boolean
          findable_by_phone?: boolean
          is_private?: boolean
          style_vibes?: string[]
          suggestable?: boolean
          terms_version?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      removed_image_fingerprints: {
        Row: {
          added_at: string
          image_hash: string
          reason: string
        }
        Insert: {
          added_at?: string
          image_hash: string
          reason: string
        }
        Update: {
          added_at?: string
          image_hash?: string
          reason?: string
        }
        Relationships: []
      }
      reserved_usernames: {
        Row: {
          username: string
        }
        Insert: {
          username: string
        }
        Update: {
          username?: string
        }
        Relationships: []
      }
      saved_items: {
        Row: {
          created_at: string
          item_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      set_items: {
        Row: {
          created_at: string
          id: string
          item_id: string
          position: Json
          set_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          position?: Json
          set_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          position?: Json
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "set_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "set_items_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      set_versions: {
        Row: {
          id: string
          layout: Json
          saved_at: string
          set_id: string
        }
        Insert: {
          id?: string
          layout: Json
          saved_at?: string
          set_id: string
        }
        Update: {
          id?: string
          layout?: Json
          saved_at?: string
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "set_versions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      sets: {
        Row: {
          alt_text: string | null
          caption: string
          comments_mode: Database["public"]["Enums"]["comments_mode"]
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          share_code: string
          song_artist: string | null
          song_cover_url: string | null
          song_title: string | null
          song_url: string | null
          status: Database["public"]["Enums"]["set_status"]
          tags: string[]
          takedown_state: Database["public"]["Enums"]["takedown_state"]
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["set_visibility"]
        }
        Insert: {
          alt_text?: string | null
          caption?: string
          comments_mode?: Database["public"]["Enums"]["comments_mode"]
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          layout?: Json
          layout_version?: number
          owner_id: string
          preview_image_id?: string | null
          published_at?: string | null
          remix_mode?: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label?: string | null
          remixed_from_set_id?: string | null
          share_code?: string
          song_artist?: string | null
          song_cover_url?: string | null
          song_title?: string | null
          song_url?: string | null
          status?: Database["public"]["Enums"]["set_status"]
          tags?: string[]
          takedown_state?: Database["public"]["Enums"]["takedown_state"]
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["set_visibility"]
        }
        Update: {
          alt_text?: string | null
          caption?: string
          comments_mode?: Database["public"]["Enums"]["comments_mode"]
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          layout?: Json
          layout_version?: number
          owner_id?: string
          preview_image_id?: string | null
          published_at?: string | null
          remix_mode?: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label?: string | null
          remixed_from_set_id?: string | null
          share_code?: string
          song_artist?: string | null
          song_cover_url?: string | null
          song_title?: string | null
          song_url?: string | null
          status?: Database["public"]["Enums"]["set_status"]
          tags?: string[]
          takedown_state?: Database["public"]["Enums"]["takedown_state"]
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["set_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "sets_remixed_from_set_id_fkey"
            columns: ["remixed_from_set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          id: string
          is_public: boolean
          kind: Database["public"]["Enums"]["template_kind"]
          layout: Json
          name: string
          owner_id: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_public?: boolean
          kind?: Database["public"]["Enums"]["template_kind"]
          layout: Json
          name: string
          owner_id?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_public?: boolean
          kind?: Database["public"]["Enums"]["template_kind"]
          layout?: Json
          name?: string
          owner_id?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          city: string | null
          created_at: string
          device_label: string
          id: string
          last_seen_at: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          device_label?: string
          id?: string
          last_seen_at?: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          device_label?: string
          id?: string
          last_seen_at?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["staff_role"]
          user_id?: string
        }
        Relationships: []
      }
      username_history: {
        Row: {
          changed_at: string
          held_until: string
          id: string
          old_username: string
          user_id: string
        }
        Insert: {
          changed_at?: string
          held_until?: string
          id?: string
          old_username: string
          user_id: string
        }
        Update: {
          changed_at?: string
          held_until?: string
          id?: string
          old_username?: string
          user_id?: string
        }
        Relationships: []
      }
      votes: {
        Row: {
          created_at: string
          device_hash: string
          hidden: boolean
          id: string
          ip_hash: string | null
          option_id: string
          poll_id: string
          updated_at: string
          voter_id: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          device_hash: string
          hidden?: boolean
          id?: string
          ip_hash?: string | null
          option_id: string
          poll_id: string
          updated_at?: string
          voter_id?: string | null
          weight?: number
        }
        Update: {
          created_at?: string
          device_hash?: string
          hidden?: boolean
          id?: string
          ip_hash?: string | null
          option_id?: string
          poll_id?: string
          updated_at?: string
          voter_id?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_totals"
            referencedColumns: ["option_id"]
          },
          {
            foreignKeyName: "votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      poll_totals: {
        Row: {
          friend_votes: number | null
          option_id: string | null
          poll_id: string | null
          raw_votes: number | null
          votes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      public_item_stats: {
        Row: {
          item_id: string | null
          set_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "set_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_view_set: {
        Args: { p_code?: string; p_set_id: string; p_viewer: string }
        Returns: boolean
      }
      claim_profile: {
        Args: {
          p_display_name?: string
          p_terms_version?: string
          p_username: string
        }
        Returns: {
          age_confirmed_at: string
          avatar_url: string | null
          bio: string
          created_at: string
          deactivated_at: string | null
          display_name: string
          findable_by_email: boolean
          findable_by_phone: boolean
          is_private: boolean
          style_vibes: string[]
          suggestable: boolean
          terms_version: string
          updated_at: string
          user_id: string
          username: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_scans: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          image_bucket: string
          image_id: string
        }[]
      }
      count_scan_attempt: { Args: { p_item_id: string }; Returns: undefined }
      my_items_scan_states: {
        Args: { p_item_ids: string[] }
        Returns: {
          item_id: string
          scan_state: string
        }[]
      }
      piece_is_shareable: { Args: { p_item_id: string }; Returns: boolean }
      record_vote: {
        Args: {
          p_device_hash: string
          p_ip_hash: string
          p_option_id: string
          p_poll_id: string
          p_voter_id: string
        }
        Returns: Json
      }
      approve_follow_request: { Args: { p_requester: string }; Returns: boolean }
      follow_counts: {
        Args: { p_user: string }
        Returns: { followers: number; following: number }[]
      }
      reopen_poll: { Args: { p_poll_id: string }; Returns: boolean }
      reset_share_code: { Args: { p_set_id: string }; Returns: string }
      save_set_layout: {
        Args: { p_layout: Json; p_set_id: string }
        Returns: number
      }
      set_by_share_code: {
        Args: { p_code: string }
        Returns: {
          alt_text: string | null
          caption: string
          comments_mode: Database["public"]["Enums"]["comments_mode"]
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          share_code: string
          song_artist: string | null
          song_cover_url: string | null
          song_title: string | null
          song_url: string | null
          status: Database["public"]["Enums"]["set_status"]
          tags: string[]
          takedown_state: Database["public"]["Enums"]["takedown_state"]
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["set_visibility"]
        }[]
        SetofOptions: {
          from: "*"
          to: "sets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      shared_poll: { Args: { p_code: string }; Returns: Json }
      shared_set: { Args: { p_code: string }; Returns: Json }
      username_available: { Args: { candidate: string }; Returns: boolean }
      username_status: { Args: { candidate: string }; Returns: string }
      vote_status: {
        Args: { p_device_hash: string; p_poll_id: string }
        Returns: Json
      }
    }
    Enums: {
      clip_trigger:
        | "share_extension"
        | "paste_link"
        | "browser_extension"
        | "upload"
      collection_visibility: "public" | "only_me"
      comments_mode: "everyone" | "followers" | "off"
      deletion_state: "pending" | "cancelled" | "completed"
      drawer_origin: "clipped" | "own_cutout" | "pickup"
      image_bucket: "item-images" | "closet-photos"
      item_kind: "product" | "non_product" | "own"
      optout_source: "form" | "meta_tag"
      remix_mode: "anyone" | "followers" | "off"
      scan_state: "pending" | "clean" | "review" | "blocked"
      set_status: "draft" | "published"
      set_visibility: "public" | "link" | "followers" | "friends" | "only_me"
      staff_role: "admin" | "moderator"
      takedown_state: "none" | "requested" | "removed"
      template_kind: "slot" | "stacked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      clip_trigger: [
        "share_extension",
        "paste_link",
        "browser_extension",
        "upload",
      ],
      collection_visibility: ["public", "only_me"],
      comments_mode: ["everyone", "followers", "off"],
      deletion_state: ["pending", "cancelled", "completed"],
      drawer_origin: ["clipped", "own_cutout", "pickup"],
      image_bucket: ["item-images", "closet-photos"],
      item_kind: ["product", "non_product", "own"],
      optout_source: ["form", "meta_tag"],
      remix_mode: ["anyone", "followers", "off"],
      scan_state: ["pending", "clean", "review", "blocked"],
      set_status: ["draft", "published"],
      set_visibility: ["public", "link", "followers", "friends", "only_me"],
      staff_role: ["admin", "moderator"],
      takedown_state: ["none", "requested", "removed"],
      template_kind: ["slot", "stacked"],
    },
  },
} as const
