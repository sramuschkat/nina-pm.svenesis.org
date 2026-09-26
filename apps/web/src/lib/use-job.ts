/**
 * Job verfolgen (TK 7.4, AP-32a): `GET /jobs/{id}` alle 1,5 s, bis er fertig oder fehlgeschlagen ist; danach
 * das Ergebnis einmal laden. Ohne `jobId` ruht der Hook.
 */
import { useQuery } from '@tanstack/react-query';
import { jobsApi } from '../api/client';

export const JOB_POLL_MS = 1500;

export function useJob<T>(jobId: string | null) {
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobsApi.get(jobId ?? ''),
    enabled: jobId !== null,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'done' || status === 'failed' ? false : JOB_POLL_MS;
    },
  });
  const ready = job.data?.status === 'done' && job.data.hasResult;
  const result = useQuery({
    queryKey: ['job-result', jobId],
    queryFn: async () => (await jobsApi.result(jobId ?? '')) as T,
    enabled: jobId !== null && ready,
    staleTime: Infinity,
  });
  const failed = job.data?.status === 'failed';
  const finished = job.data?.status === 'done' || failed;
  return {
    job,
    result,
    /** Läuft noch (angelegt, wartend oder in Arbeit); Jobs ohne Ergebnisdatei sind mit `done` fertig. */
    running: jobId !== null && !finished && !job.isError,
    failed,
    errorCode: job.data?.errorCode ?? null,
  };
}
