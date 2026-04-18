import { randomUUID } from "node:crypto";

export type AnalysisJobStatus = "pending" | "running" | "completed" | "failed";

export interface AnalysisJobEvent {
  type: "agent_start" | "agent_done" | "complete" | "error";
  [key: string]: unknown;
}

export interface AnalysisJobSnapshot {
  id: string;
  accessToken: string;
  status: AnalysisJobStatus;
  createdAt: string;
  updatedAt: string;
  events: AnalysisJobEvent[];
  result?: unknown;
  error?: string;
}

interface AnalysisJobRecord extends AnalysisJobSnapshot {
  listeners: Set<(event: AnalysisJobEvent) => void>;
}

export interface AnalysisJobManager {
  createJob(): AnalysisJobSnapshot;
  startJob(
    jobId: string,
    task: (helpers: { emit: (event: AnalysisJobEvent) => void }) => Promise<unknown>
  ): void;
  getJob(jobId: string): AnalysisJobSnapshot | null;
  subscribe(jobId: string, listener: (event: AnalysisJobEvent) => void): (() => void) | null;
}

function now(): string {
  return new Date().toISOString();
}

function cloneJob(job: AnalysisJobRecord): AnalysisJobSnapshot {
  return {
    id: job.id,
    accessToken: job.accessToken,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    events: [...job.events],
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {})
  };
}

export function createAnalysisJobManager(): AnalysisJobManager {
  const jobs = new Map<string, AnalysisJobRecord>();

  function getRecord(jobId: string): AnalysisJobRecord {
    const record = jobs.get(jobId);
    if (!record) {
      throw new Error(`Unknown analysis job: ${jobId}`);
    }
    return record;
  }

  function pushEvent(job: AnalysisJobRecord, event: AnalysisJobEvent): void {
    job.updatedAt = now();
    job.events.push(event);
    for (const listener of job.listeners) {
      listener(event);
    }
  }

  return {
    createJob() {
      const createdAt = now();
      const job: AnalysisJobRecord = {
        id: randomUUID(),
        accessToken: randomUUID(),
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        events: [],
        listeners: new Set()
      };

      jobs.set(job.id, job);
      return cloneJob(job);
    },

    startJob(jobId, task) {
      const job = getRecord(jobId);
      if (job.status !== "pending") {
        return;
      }

      job.status = "running";
      job.updatedAt = now();

      void task({
        emit(event) {
          pushEvent(job, event);
        }
      })
        .then((result) => {
          job.status = "completed";
          job.result = result;
          pushEvent(job, {
            type: "complete",
            at: now(),
            analysis: result
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Analysis job failed.";
          job.status = "failed";
          job.error = message;
          pushEvent(job, {
            type: "error",
            at: now(),
            message
          });
        });
    },

    getJob(jobId) {
      const job = jobs.get(jobId);
      return job ? cloneJob(job) : null;
    },

    subscribe(jobId, listener) {
      const job = jobs.get(jobId);
      if (!job) {
        return null;
      }

      job.listeners.add(listener);
      return () => {
        job.listeners.delete(listener);
      };
    }
  };
}
