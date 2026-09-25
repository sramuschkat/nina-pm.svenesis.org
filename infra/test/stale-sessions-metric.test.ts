/**
 * AP-15 (CC-16, TK 16.2): Die Metrik `StaleRunningSessions` entsteht im `worker` als EMF-Zeile
 * (`emfLine` aus `@nina-pm/shared`). Dieser Test prüft, dass der Pflichtalarm genau diese Metrik liest
 * (Namespace, Name, Dimension `service` = Funktionsname) und bei einem Wert > 0 auslöst.
 */
import { APP_METRICS, emfLine, METRIC_NAMESPACE } from '@nina-pm/shared';
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { resources, synth } from './synth';

const { ops } = synth();

interface AlarmProps {
  AlarmName: string;
  Namespace: string;
  MetricName: string;
  Dimensions: { Name: string; Value: string }[];
  Threshold: number;
  ComparisonOperator: string;
}

function alarm(): AlarmProps {
  const found = resources(ops, 'AWS::CloudWatch::Alarm').find(
    ([, a]) => a.Properties.AlarmName === 'nina-pm-stale-running-sessions',
  );
  if (!found) throw new Error('Alarm nina-pm-stale-running-sessions fehlt');
  return found[1].Properties as unknown as AlarmProps;
}

/** Wertet eine EMF-Zeile so aus, wie CloudWatch sie für den Alarm liest. */
function fires(line: string, a: AlarmProps): boolean {
  const doc = JSON.parse(line) as Record<string, unknown> & {
    _aws: {
      CloudWatchMetrics: {
        Namespace: string;
        Dimensions: string[][];
        Metrics: { Name: string }[];
      }[];
    };
  };
  const directive = doc._aws.CloudWatchMetrics[0];
  if (!directive || directive.Namespace !== a.Namespace) return false;
  if (!directive.Metrics.some((m) => m.Name === a.MetricName)) return false;
  const dims = directive.Dimensions[0] ?? [];
  const matches = a.Dimensions.every((d) => dims.includes(d.Name) && doc[d.Name] === d.Value);
  if (!matches) return false;
  const value = Number(doc[a.MetricName]);
  return a.ComparisonOperator === 'GreaterThanThreshold' && value > a.Threshold;
}

describe('StaleRunningSessions (CC-16)', () => {
  const service = config.lambdas.worker.functionName;

  it('der Alarm liest die Metrik, die der worker schreibt', () => {
    const a = alarm();
    expect(a).toMatchObject({
      Namespace: METRIC_NAMESPACE,
      MetricName: APP_METRICS.staleRunningSessions,
      Dimensions: [{ Name: 'service', Value: service }],
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  it('eine verwaiste Session löst den Alarm aus, keine nicht; falscher Dienst nicht', () => {
    const a = alarm();
    const metric = (v: number, svc: string = service) =>
      emfLine(svc, 0, [{ name: APP_METRICS.staleRunningSessions, value: v }]);
    expect(fires(metric(1), a)).toBe(true);
    expect(fires(metric(0), a)).toBe(false);
    expect(fires(metric(3, 'nina-pm-api'), a)).toBe(false);
  });
});

describe('DsqlRetries (TK 16.2)', () => {
  it('der Alarm summiert genau die Metrik, die api und worker je Wiederholung schreiben', () => {
    const found = resources(ops, 'AWS::CloudWatch::Alarm').find(
      ([, a]) => a.Properties.AlarmName === 'nina-pm-dsql-retries',
    );
    const props = found?.[1].Properties as {
      Threshold: number;
      Metrics: {
        MetricStat?: {
          Metric: {
            Namespace: string;
            MetricName: string;
            Dimensions: { Name: string; Value: string }[];
          };
        };
      }[];
    };
    const stats = props.Metrics.filter((m) => m.MetricStat).map((m) => m.MetricStat?.Metric);
    expect(props.Threshold).toBe(20);
    for (const service of [config.lambdas.api.functionName, config.lambdas.worker.functionName]) {
      const line = JSON.parse(
        emfLine(service, 0, [{ name: APP_METRICS.dsqlRetries, value: 1 }]),
      ) as {
        _aws: { CloudWatchMetrics: { Namespace: string; Metrics: { Name: string }[] }[] };
        service: string;
      };
      expect(stats).toContainEqual({
        Namespace: line._aws.CloudWatchMetrics[0]?.Namespace,
        MetricName: line._aws.CloudWatchMetrics[0]?.Metrics[0]?.Name,
        Dimensions: [{ Name: 'service', Value: line.service }],
      });
    }
  });
});
