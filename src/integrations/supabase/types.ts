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
      admin_audit_log: {
        Row: {
          admin_id: string
          created_at: string
          id: number
          reason: string
          target_id: string | null
          what: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: never
          reason?: string
          target_id?: string | null
          what: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: never
          reason?: string
          target_id?: string | null
          what?: string
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
      appeals: {
        Row: {
          body: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string
          state: string
          strike_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string
          state?: string
          strike_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string
          state?: string
          strike_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appeals_strike_id_fkey"
            columns: ["strike_id"]
            isOneToOne: true
            referencedRelation: "strikes"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_answers: {
        Row: {
          ask_id: string
          author_id: string
          body: string
          chosen: boolean
          created_at: string
          id: string
          set_id: string
        }
        Insert: {
          ask_id: string
          author_id: string
          body?: string
          chosen?: boolean
          created_at?: string
          id?: string
          set_id: string
        }
        Update: {
          ask_id?: string
          author_id?: string
          body?: string
          chosen?: boolean
          created_at?: string
          id?: string
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_answers_ask_id_fkey"
            columns: ["ask_id"]
            isOneToOne: false
            referencedRelation: "ask_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ask_answers_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_posts: {
        Row: {
          author_id: string
          closed_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          question: string
        }
        Insert: {
          author_id: string
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          question: string
        }
        Update: {
          author_id?: string
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          question?: string
        }
        Relationships: []
      }
      badges: {
        Row: {
          awarded_at: string
          badge: string
          user_id: string
        }
        Insert: {
          awarded_at?: string
          badge: string
          user_id: string
        }
        Update: {
          awarded_at?: string
          badge?: string
          user_id?: string
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
      click_totals: {
        Row: {
          clicks: number
          day: string
          item_id: string
          network: string
        }
        Insert: {
          clicks: number
          day: string
          item_id: string
          network: string
        }
        Update: {
          clicks?: number
          day?: string
          item_id?: string
          network?: string
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
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          held_at: string | null
          id: string
          set_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          held_at?: string | null
          id?: string
          set_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          held_at?: string | null
          id?: string
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          client: string
          created_at: string
          email: string
          id: string
          ip_hash: string | null
          message: string
          name: string
          note: string
          request_ref: string
          state: string
          topic: string
          user_id: string | null
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          client?: string
          created_at?: string
          email: string
          id?: string
          ip_hash?: string | null
          message: string
          name: string
          note?: string
          request_ref: string
          state?: string
          topic: string
          user_id?: string | null
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          client?: string
          created_at?: string
          email?: string
          id?: string
          ip_hash?: string | null
          message?: string
          name?: string
          note?: string
          request_ref?: string
          state?: string
          topic?: string
          user_id?: string | null
        }
        Relationships: []
      }
      contest_entries: {
        Row: {
          contest_id: string
          created_at: string
          set_id: string
          user_id: string
        }
        Insert: {
          contest_id: string
          created_at?: string
          set_id: string
          user_id: string
        }
        Update: {
          contest_id?: string
          created_at?: string
          set_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contest_entries_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "contests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contest_entries_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      contest_themes: {
        Row: {
          created_at: string
          id: string
          position: number
          theme: string
          title: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          position: number
          theme?: string
          title: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          theme?: string
          title?: string
          used_at?: string | null
        }
        Relationships: []
      }
      contests: {
        Row: {
          announced_at: string | null
          closes_at: string
          created_at: string
          created_by: string | null
          id: string
          opens_at: string
          theme: string
          title: string
        }
        Insert: {
          announced_at?: string | null
          closes_at: string
          created_at?: string
          created_by?: string | null
          id?: string
          opens_at?: string
          theme?: string
          title: string
        }
        Update: {
          announced_at?: string | null
          closes_at?: string
          created_at?: string
          created_by?: string | null
          id?: string
          opens_at?: string
          theme?: string
          title?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          left_a: string | null
          left_b: string | null
          requested_by: string | null
          state: string
          user_a: string | null
          user_b: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          left_a?: string | null
          left_b?: string | null
          requested_by?: string | null
          state?: string
          user_a?: string | null
          user_b?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          left_a?: string | null
          left_b?: string | null
          requested_by?: string | null
          state?: string
          user_a?: string | null
          user_b?: string | null
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
      external_cleanups: {
        Row: {
          attempts: number
          created_at: string
          done_at: string | null
          id: number
          service: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          done_at?: string | null
          id?: never
          service: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          done_at?: string | null
          id?: never
          service?: string
          user_id?: string
        }
        Relationships: []
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
      group_members: {
        Row: {
          created_at: string
          group_id: string
          invited_by: string | null
          role: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          invited_by?: string | null
          role?: string
          state?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          invited_by?: string | null
          role?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          group_id: string
          id: string
          set_id: string | null
        }
        Insert: {
          author_id: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          group_id: string
          id?: string
          set_id?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          group_id?: string
          id?: string
          set_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_posts_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          creator_id: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          visibility: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          deleted_at?: string | null
          description?: string
          id?: string
          name: string
          visibility?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          visibility?: string
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
          owner_id: string | null
          price_cents: number | null
          price_checked_at: string | null
          price_currency: string | null
          purged_at: string | null
          search: unknown
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
          owner_id?: string | null
          price_cents?: number | null
          price_checked_at?: string | null
          price_currency?: string | null
          purged_at?: string | null
          search?: unknown
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
          owner_id?: string | null
          price_cents?: number | null
          price_checked_at?: string | null
          price_currency?: string | null
          purged_at?: string | null
          search?: unknown
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
      likes: {
        Row: {
          created_at: string
          set_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          set_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          set_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          photo_item_id: string | null
          sender_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          photo_item_id?: string | null
          sender_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          photo_item_id?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_photo_item_id_fkey"
            columns: ["photo_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action: string
          created_at: string
          id: string
          moderator_id: string | null
          note: string
          report_id: string | null
          target_id: string
          target_type: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          moderator_id?: string | null
          note?: string
          report_id?: string | null
          target_id: string
          target_type: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          moderator_id?: string | null
          note?: string
          report_id?: string | null
          target_id?: string
          target_type?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      mutes: {
        Row: {
          created_at: string
          muted_id: string
          muter_id: string
        }
        Insert: {
          created_at?: string
          muted_id: string
          muter_id: string
        }
        Update: {
          created_at?: string
          muted_id?: string
          muter_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          bundled_count: number
          created_at: string
          id: string
          kind: string
          read_at: string | null
          ref_id: string | null
          ref_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          bundled_count?: number
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          bundled_count?: number
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          updated_at?: string
          user_id?: string
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
      points_ledger: {
        Row: {
          created_at: string
          id: number
          points: number
          reason: string
          ref: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          points: number
          reason: string
          ref: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          points?: number
          reason?: string
          ref?: string
          user_id?: string
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
          results_told_at: string | null
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
          results_told_at?: string | null
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
          results_told_at?: string | null
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
          banned_at: string | null
          bio: string
          comments_default: string
          created_at: string
          deactivated_at: string | null
          display_name: string
          dm_setting: string
          findable_by_email: boolean
          findable_by_phone: boolean
          is_private: boolean
          mention_setting: string
          points: number
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
          banned_at?: string | null
          bio?: string
          comments_default?: string
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          dm_setting?: string
          findable_by_email?: boolean
          findable_by_phone?: boolean
          is_private?: boolean
          mention_setting?: string
          points?: number
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
          banned_at?: string | null
          bio?: string
          comments_default?: string
          created_at?: string
          deactivated_at?: string | null
          display_name?: string
          dm_setting?: string
          findable_by_email?: boolean
          findable_by_phone?: boolean
          is_private?: boolean
          mention_setting?: string
          points?: number
          style_vibes?: string[]
          suggestable?: boolean
          terms_version?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      push_queue: {
        Row: {
          attempts: number
          created_at: string
          due_at: string
          id: number
          kind: string
          notification_id: string | null
          ref_id: string | null
          ref_type: string | null
          sent_at: string | null
          state: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          due_at: string
          id?: never
          kind: string
          notification_id?: string | null
          ref_id?: string | null
          ref_type?: string | null
          sent_at?: string | null
          state?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          due_at?: string
          id?: never
          kind?: string
          notification_id?: string | null
          ref_id?: string | null
          ref_type?: string | null
          sent_at?: string | null
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_queue_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      push_settings: {
        Row: {
          enabled: boolean
          muted_kinds: string[]
          platform: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          muted_kinds?: string[]
          platform?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          muted_kinds?: string[]
          platform?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          set_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          set_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          set_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
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
      reports: {
        Row: {
          created_at: string
          evidence: Json | null
          id: string
          note: string
          priority: string
          reason: string
          reporter_id: string | null
          request_ref: string
          resolution_note: string
          resolved_at: string | null
          resolved_by: string | null
          state: string
          target_id: string
          target_owner_id: string | null
          target_type: string
        }
        Insert: {
          created_at?: string
          evidence?: Json | null
          id?: string
          note?: string
          priority?: string
          reason: string
          reporter_id?: string | null
          request_ref: string
          resolution_note?: string
          resolved_at?: string | null
          resolved_by?: string | null
          state?: string
          target_id: string
          target_owner_id?: string | null
          target_type: string
        }
        Update: {
          created_at?: string
          evidence?: Json | null
          id?: string
          note?: string
          priority?: string
          reason?: string
          reporter_id?: string | null
          request_ref?: string
          resolution_note?: string
          resolved_at?: string | null
          resolved_by?: string | null
          state?: string
          target_id?: string
          target_owner_id?: string | null
          target_type?: string
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
      set_tags: {
        Row: {
          created_at: string
          id: string
          set_id: string
          state: string
          tagged_by: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          set_id: string
          state?: string
          tagged_by: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          set_id?: string
          state?: string
          tagged_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "set_tags_set_id_fkey"
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
          comments_setting: string
          created_at: string
          deleted_at: string | null
          description: string
          featured_at: string | null
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          search: unknown
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
          comments_setting?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          featured_at?: string | null
          id?: string
          layout?: Json
          layout_version?: number
          owner_id: string
          preview_image_id?: string | null
          published_at?: string | null
          remix_mode?: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label?: string | null
          remixed_from_set_id?: string | null
          search?: unknown
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
          comments_setting?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          featured_at?: string | null
          id?: string
          layout?: Json
          layout_version?: number
          owner_id?: string
          preview_image_id?: string | null
          published_at?: string | null
          remix_mode?: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label?: string | null
          remixed_from_set_id?: string | null
          search?: unknown
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
      strikes: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          kind: string
          reason: string
          report_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          reason?: string
          report_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          reason?: string
          report_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strikes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      takedown_requests: {
        Row: {
          created_at: string
          details: string
          email: string
          id: string
          ip_hash: string | null
          kind: string
          name: string
          note: string
          request_ref: string
          resolved_at: string | null
          resolved_by: string | null
          signature: string
          state: string
          statements: boolean
          urls: string[]
          work: string
        }
        Insert: {
          created_at?: string
          details?: string
          email: string
          id?: string
          ip_hash?: string | null
          kind: string
          name: string
          note?: string
          request_ref: string
          resolved_at?: string | null
          resolved_by?: string | null
          signature?: string
          state?: string
          statements?: boolean
          urls: string[]
          work?: string
        }
        Update: {
          created_at?: string
          details?: string
          email?: string
          id?: string
          ip_hash?: string | null
          kind?: string
          name?: string
          note?: string
          request_ref?: string
          resolved_at?: string | null
          resolved_by?: string | null
          signature?: string
          state?: string
          statements?: boolean
          urls?: string[]
          work?: string
        }
        Relationships: []
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
      text_checks: {
        Row: {
          attempts: number
          author_id: string | null
          body: string
          checked_at: string | null
          created_at: string
          id: number
          kind: string
          labels: Json | null
          state: string
          target_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          author_id?: string | null
          body: string
          checked_at?: string | null
          created_at?: string
          id?: never
          kind: string
          labels?: Json | null
          state?: string
          target_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          author_id?: string | null
          body?: string
          checked_at?: string | null
          created_at?: string
          id?: never
          kind?: string
          labels?: Json | null
          state?: string
          target_id?: string
          updated_at?: string
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
      accept_message_request: {
        Args: { p_conversation: string }
        Returns: boolean
      }
      admin_user_lookup: {
        Args: { p_reason: string; p_username: string }
        Returns: {
          actions: Json
          banned_at: string
          created_at: string
          deactivated_at: string
          display_name: string
          is_private: boolean
          live_strikes: number
          points: number
          reports_about: number
          sets_published: number
          user_id: string
          username: string
        }[]
      }
      approve_follow_request: {
        Args: { p_requester: string }
        Returns: boolean
      }
      blocked_people: {
        Args: never
        Returns: {
          blocked_at: string
          display_name: string
          user_id: string
          username: string
        }[]
      }
      can_view_set: {
        Args: { p_code?: string; p_set_id: string; p_viewer: string }
        Returns: boolean
      }
      cancel_account_deletion: { Args: never; Returns: boolean }
      claim_cleanups: {
        Args: { p_limit?: number }
        Returns: {
          id: number
          service: string
          user_id: string
        }[]
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
          banned_at: string | null
          bio: string
          comments_default: string
          created_at: string
          deactivated_at: string | null
          display_name: string
          dm_setting: string
          findable_by_email: boolean
          findable_by_phone: boolean
          is_private: boolean
          mention_setting: string
          points: number
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
      claim_purges: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          image_bucket: Database["public"]["Enums"]["image_bucket"]
          image_id: string
          keep_evidence: boolean
        }[]
      }
      claim_pushes: {
        Args: { p_limit?: number }
        Returns: {
          actor_username: string
          bundled_count: number
          due_at: string
          id: number
          kind: string
          ref_id: string
          ref_type: string
          user_id: string
        }[]
      }
      claim_scans: {
        Args: { p_limit?: number }
        Returns: {
          id: string
          image_bucket: string
          image_id: string
        }[]
      }
      claim_text_checks: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          id: number
          kind: string
          target_id: string
        }[]
      }
      closet_item_uses: { Args: { p_item_id: string }; Returns: number }
      contact_resolve: {
        Args: { p_id: string; p_note?: string; p_outcome: string }
        Returns: undefined
      }
      contest_board: {
        Args: { p_contest: string }
        Returns: {
          entered_at: string
          likes: number
          preview_image_id: string
          set_id: string
          title: string
          user_id: string
          username: string
        }[]
      }
      count_scan_attempt: { Args: { p_item_id: string }; Returns: undefined }
      decide_appeal: {
        Args: { p_appeal: string; p_note?: string; p_outcome: string }
        Returns: undefined
      }
      delete_closet_item: {
        Args: { p_item_id: string; p_keep_in_sets?: boolean }
        Returns: number
      }
      erase_closet_item: { Args: { p_item_id: string }; Returns: undefined }
      erase_set: { Args: { p_set_id: string }; Returns: boolean }
      feed_featured: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          alt_text: string | null
          caption: string
          comments_mode: Database["public"]["Enums"]["comments_mode"]
          comments_setting: string
          created_at: string
          deleted_at: string | null
          description: string
          featured_at: string | null
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          search: unknown
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
      feed_following: {
        Args: { p_before?: string; p_limit?: number }
        Returns: {
          alt_text: string | null
          caption: string
          comments_mode: Database["public"]["Enums"]["comments_mode"]
          comments_setting: string
          created_at: string
          deleted_at: string | null
          description: string
          featured_at: string | null
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          search: unknown
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
      file_report: {
        Args: {
          p_id: string
          p_note?: string
          p_reason: string
          p_type: string
        }
        Returns: string
      }
      follow_counts: {
        Args: { p_user: string }
        Returns: {
          followers: number
          following: number
        }[]
      }
      hide_vote: {
        Args: { p_hidden?: boolean; p_vote: string }
        Returns: undefined
      }
      leave_conversation: { Args: { p_id: string }; Returns: undefined }
      level_of: { Args: { p_points: number }; Returns: number }
      lock_down: { Args: never; Returns: number }
      log_private_view: {
        Args: { p_reason: string; p_target: string; p_what: string }
        Returns: undefined
      }
      make_all_link_only: { Args: never; Returns: number }
      mark_cleanup: { Args: { p_id: number }; Returns: undefined }
      mark_purged: { Args: { p_item: string }; Returns: undefined }
      mark_pushes: {
        Args: { p_ids: number[]; p_state: string }
        Returns: undefined
      }
      moderate: {
        Args: { p_action: string; p_note?: string; p_report: string }
        Returns: undefined
      }
      moderation_queue: {
        Args: never
        Returns: {
          body: string
          created_at: string
          evidence: Json
          id: string
          note: string
          preview_image_id: string
          priority: string
          reason: string
          reports_on_target: number
          request_ref: string
          state: string
          target_id: string
          target_owner: string
          target_type: string
          target_username: string
          title: string
        }[]
      }
      muted_people: {
        Args: never
        Returns: {
          display_name: string
          muted_at: string
          user_id: string
          username: string
        }[]
      }
      my_items_scan_states: {
        Args: { p_item_ids: string[] }
        Returns: {
          item_id: string
          scan_state: string
        }[]
      }
      my_points: {
        Args: never
        Returns: {
          badges: string[]
          level: number
          points: number
        }[]
      }
      my_poll_votes: {
        Args: { p_limit?: number; p_poll: string }
        Returns: {
          created_at: string
          hidden: boolean
          id: string
          is_friend: boolean
          option_id: string
          signed_in: boolean
          weight: number
        }[]
      }
      my_reports: {
        Args: never
        Returns: {
          created_at: string
          reason: string
          request_ref: string
          resolved_at: string
          state: string
          target_type: string
        }[]
      }
      my_roles: { Args: never; Returns: string[] }
      my_strikes: {
        Args: never
        Returns: {
          appeal_note: string
          appeal_state: string
          created_at: string
          expires_at: string
          id: string
          kind: string
          reason: string
        }[]
      }
      piece_is_shareable: { Args: { p_item_id: string }; Returns: boolean }
      popular_tags: {
        Args: { p_limit?: number }
        Returns: {
          sets: number
          tag: string
        }[]
      }
      public_set_codes: {
        Args: { p_limit?: number }
        Returns: {
          published_at: string
          share_code: string
        }[]
      }
      record_text_check: {
        Args: { p_id: number; p_labels?: Json; p_state: string }
        Returns: undefined
      }
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
      remix_set: { Args: { p_set_id: string }; Returns: Json }
      reopen_poll: { Args: { p_poll_id: string }; Returns: boolean }
      request_account_deletion: { Args: never; Returns: string }
      reset_share_code: { Args: { p_set_id: string }; Returns: string }
      restore_closet_item: { Args: { p_item_id: string }; Returns: undefined }
      save_set_layout: {
        Args: { p_layout: Json; p_set_id: string }
        Returns: number
      }
      search_items: {
        Args: {
          p_limit?: number
          p_max_cents?: number
          p_store?: string
          q: string
        }
        Returns: {
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
          owner_id: string | null
          price_cents: number | null
          price_checked_at: string | null
          price_currency: string | null
          purged_at: string | null
          search: unknown
          sold_out: boolean
          source_domain: string | null
          source_url: string | null
          store_name: string | null
          takedown_state: Database["public"]["Enums"]["takedown_state"]
          title: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_sets: {
        Args: { p_limit?: number; q: string }
        Returns: {
          alt_text: string | null
          caption: string
          comments_mode: Database["public"]["Enums"]["comments_mode"]
          comments_setting: string
          created_at: string
          deleted_at: string | null
          description: string
          featured_at: string | null
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          search: unknown
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
      send_message: {
        Args: { p_body: string; p_photo?: string; p_to: string }
        Returns: string
      }
      set_by_share_code: {
        Args: { p_code: string }
        Returns: {
          alt_text: string | null
          caption: string
          comments_mode: Database["public"]["Enums"]["comments_mode"]
          comments_setting: string
          created_at: string
          deleted_at: string | null
          description: string
          featured_at: string | null
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          search: unknown
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
      set_people: {
        Args: { p_set_id: string }
        Returns: {
          state: string
          user_id: string
          username: string
        }[]
      }
      set_social: {
        Args: { p_set: string }
        Returns: {
          comments: number
          likes: number
          my_like: boolean
          my_reaction: string
          reactions: Json
        }[]
      }
      set_social_many: {
        Args: { p_ids: string[] }
        Returns: {
          comments: number
          likes: number
          my_like: boolean
          set_id: string
        }[]
      }
      set_suspended: {
        Args: { p_on: boolean; p_reason: string; p_user: string }
        Returns: undefined
      }
      sets_by_tag: {
        Args: { p_limit?: number; p_tag: string }
        Returns: {
          alt_text: string | null
          caption: string
          comments_mode: Database["public"]["Enums"]["comments_mode"]
          comments_setting: string
          created_at: string
          deleted_at: string | null
          description: string
          featured_at: string | null
          id: string
          layout: Json
          layout_version: number
          owner_id: string
          preview_image_id: string | null
          published_at: string | null
          remix_mode: Database["public"]["Enums"]["remix_mode"]
          remixed_from_label: string | null
          remixed_from_set_id: string | null
          search: unknown
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
      stores: {
        Args: { p_limit?: number }
        Returns: {
          domain: string
          products: number
          store_name: string
        }[]
      }
      takedown_resolve: {
        Args: {
          p_id: string
          p_item?: string
          p_note?: string
          p_outcome: string
        }
        Returns: number
      }
      takedown_status: {
        Args: { p_ref: string }
        Returns: {
          created_at: string
          kind: string
          resolved_at: string
          state: string
        }[]
      }
      text_verdict: {
        Args: { p_kind?: string; p_text: string }
        Returns: string
      }
      unread_notifications: { Args: never; Returns: number }
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
