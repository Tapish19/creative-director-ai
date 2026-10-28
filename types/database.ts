import type { Project } from "@/types/campaign";
import type {
  AgentRun,
  Generation,
  Job,
  Scene,
  Voiceover,
  Video,
  Review,
  ReviewTask,
  GenerationApproval,
} from "@/types/generation";
import type { AgentType, GenerationStatus, StepStatus } from "@/types/campaign";

// Kept in sync with versioned SQL. Regenerate with Supabase CLI after applying migrations.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
type ProjectInsert = Omit<Project, "id" | "status" | "created_at" | "updated_at"> & { id?: string };
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: Project;
        Insert: ProjectInsert;
        Update: Partial<Omit<ProjectInsert, "user_id" | "id">>;
        Relationships: [];
      };
      generations: Table<Generation>;
      agent_runs: Table<AgentRun>;
      scenes: Table<Scene>;
      voiceovers: Table<Voiceover>;
      jobs: Table<Job>;
      reviews: Table<Review>;
      review_tasks: Table<ReviewTask>;
      videos: Table<Video>;
      generation_approvals: Table<GenerationApproval>;
    };
    Views: { [_ in never]: never };
    Functions: {
      approve_generation: {
        Args: {
          p_generation_id: string;
          p_video_id: string;
          p_review_id: string;
          p_confirmed: boolean;
          p_accept_low_score?: boolean;
          p_note?: string;
        };
        Returns: string;
      };
      enqueue_revision: {
        Args: {
          p_parent_id: string;
          p_request_key: string;
          p_mode: string;
          p_instruction?: string;
          p_script?: Json | null;
          p_scene_id?: string | null;
          p_visual_prompt?: string | null;
        };
        Returns: string;
      };
      enqueue_review: { Args: { p_generation_id: string }; Returns: undefined };
      claim_review_job: {
        Args: {
          p_worker_id: string;
          p_quality_threshold: number;
          p_max_automatic_revisions?: number;
        };
        Returns: Json;
      };
      heartbeat_review_job: { Args: { p_job_id: string; p_token: string }; Returns: boolean };
      begin_review_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_input: Json;
          p_provider: string;
          p_model: string;
        };
        Returns: string;
      };
      finish_review_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_run_id: string;
          p_output: Json | null;
          p_execution_time: number;
          p_error_code: string | null;
          p_error_message: string | null;
          p_retry: boolean;
          p_delay_ms: number;
          p_model: string;
          p_usage: Json | null;
        };
        Returns: boolean;
      };
      enqueue_render: { Args: { p_generation_id: string }; Returns: undefined };
      claim_render_job: { Args: { p_worker_id: string }; Returns: Json };
      heartbeat_render_job: { Args: { p_job_id: string; p_token: string }; Returns: boolean };
      begin_render_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_input: Json;
          p_provider: string;
          p_model: string;
        };
        Returns: string;
      };
      finish_render_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_run_id: string;
          p_output: Json | null;
          p_execution_time: number;
          p_error_code: string | null;
          p_error_message: string | null;
          p_retry: boolean;
          p_delay_ms: number;
        };
        Returns: boolean;
      };
      enqueue_voice: { Args: { p_generation_id: string }; Returns: undefined };
      claim_voice_job: { Args: { p_worker_id: string }; Returns: Json };
      heartbeat_voice_job: { Args: { p_job_id: string; p_token: string }; Returns: boolean };
      begin_voice_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_input: Json;
          p_provider: string;
          p_model: string;
        };
        Returns: string;
      };
      finish_voice_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_run_id: string;
          p_output: Json | null;
          p_execution_time: number;
          p_error_code: string | null;
          p_error_message: string | null;
          p_retry: boolean;
          p_delay_ms: number;
        };
        Returns: boolean;
      };
      enqueue_scene_images: {
        Args: { p_generation_id: string; p_scene_id?: string };
        Returns: undefined;
      };
      claim_image_job: { Args: { p_worker_id: string }; Returns: Json };
      heartbeat_image_job: { Args: { p_job_id: string; p_token: string }; Returns: boolean };
      begin_image_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_input: Json;
          p_provider: string;
          p_model: string;
        };
        Returns: string;
      };
      finish_image_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_run_id: string;
          p_output: Json | null;
          p_execution_time: number;
          p_error_code: string | null;
          p_error_message: string | null;
          p_retry: boolean;
          p_delay_ms: number;
        };
        Returns: boolean;
      };
      enqueue_text_generation: {
        Args: { p_project_id: string; p_request_key: string };
        Returns: string;
      };
      claim_text_job: { Args: { p_worker_id: string }; Returns: Json };
      heartbeat_text_job: { Args: { p_job_id: string; p_token: string }; Returns: boolean };
      begin_text_agent: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_agent: AgentType;
          p_input: Json;
          p_provider: string;
          p_model: string;
        };
        Returns: Json;
      };
      record_text_attempt: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_run_id: string;
          p_status: StepStatus;
          p_output: Json | null;
          p_usage: Json | null;
          p_model: string;
          p_execution_time: number;
          p_error_code: string | null;
          p_error_message: string | null;
        };
        Returns: undefined;
      };
      defer_text_job: {
        Args: {
          p_job_id: string;
          p_token: string;
          p_retry: boolean;
          p_delay_ms: number;
          p_error: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      project_status: Project["status"];
      generation_status: GenerationStatus;
      step_status: StepStatus;
      agent_type: AgentType;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
